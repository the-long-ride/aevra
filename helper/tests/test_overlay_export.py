"""Exercise the real exporter with isolated source/vendor trees and a pinned Git view."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("overlay", Path(__file__).parents[1] / "export-desktop-overlay.py")
OVERLAY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OVERLAY)
REAL_RUN = subprocess.run


class OverlayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.desktop = self.root / "desktop"
        self.vendor = self.desktop / "vendor/aevra"
        self.vendor.mkdir(parents=True)
        (self.source / "helper/src").mkdir(parents=True)
        self.base = {"helper/src/example.rs": "original\n"}
        self.write(self.vendor, "helper/src/example.rs", "original\n")
        self.write(self.source, "helper/src/example.rs", "generated\n")
        self.addCleanup(patch.stopall)
        patch.object(OVERLAY, "__file__", str(self.source / "helper/export-desktop-overlay.py")).start()
        patch.object(OVERLAY.subprocess, "check_output", return_value="base\n").start()
        patch.object(OVERLAY.subprocess, "run", side_effect=self.git_view).start()

    def git_view(self, args, **kwargs):
        if "ls-tree" in args:
            return subprocess.CompletedProcess(args, 0, "\n".join(self.base).encode(), b"")
        if "show" not in args:
            return REAL_RUN(args, **kwargs)
        value = self.base.get(args[-1].split(":", 1)[1])
        return subprocess.CompletedProcess(args, 0 if value is not None else 1,
                                           (value or "").encode(), b"")

    def write(self, root, name, value):
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(value, encoding="utf-8", newline="\n")

    def initial(self):
        OVERLAY.export(self.desktop, False)
        self.write(self.vendor, "helper/src/example.rs", "generated\n")

    def assert_clean_apply(self):
        clean = self.root / "clean"
        clean.mkdir()
        for name, value in self.base.items():
            self.write(clean, name, value)
        delta = self.desktop / "patches/helper-parity.patch"
        if delta.read_text(encoding="utf-8"):
            REAL_RUN(["git", "-c", "core.autocrlf=false", "apply", str(delta)], cwd=clean, check=True, capture_output=True)
        def tree(root):
            return {str(p.relative_to(root)): p.read_bytes() for p in root.rglob("*") if p.is_file()}
        self.assertEqual(tree(clean), tree(self.vendor))

    def test_gnome_policy_regression_is_synced_and_in_clean_patch(self):
        self.initial()
        name = "helper/wayland/gnome/policy.test.mjs"
        self.write(self.source, name, "// compositor policy regression\n")
        OVERLAY.export(self.desktop, True)
        self.assertEqual((self.vendor / name).read_text(), "// compositor policy regression\n")
        self.assert_clean_apply()

    def test_macos_prerequisites_survive_repeat_sync_and_clean_apply(self):
        self.initial()
        for name in ["helper/setup-macos.mjs", "helper/tests/macos-build.test.mjs"]:
            self.write(self.source, name, "// SDK contract\n")
        OVERLAY.export(self.desktop, True)
        OVERLAY.export(self.desktop, True)
        self.assert_clean_apply()

    def test_reverted_modification_restores_base_and_drops_manifest_entry(self):
        self.initial()
        self.write(self.source, "helper/src/example.rs", "original\n")
        OVERLAY.export(self.desktop, True)
        self.assertEqual((self.vendor / "helper/src/example.rs").read_text(), "original\n")
        self.assert_clean_apply()

    def test_removed_generated_addition_is_deleted(self):
        self.write(self.source, "helper/src/new.rs", "added\n")
        self.initial()
        self.write(self.vendor, "helper/src/new.rs", "added\n")
        (self.source / "helper/src/new.rs").unlink()
        OVERLAY.export(self.desktop, True)
        self.assertFalse((self.vendor / "helper/src/new.rs").exists())
        self.assert_clean_apply()

    def test_removed_base_file_exports_deletion(self):
        self.initial()
        (self.source / "helper/src/example.rs").unlink()
        OVERLAY.export(self.desktop, True)
        self.assertFalse((self.vendor / "helper/src/example.rs").exists())
        manifest = json.loads((self.desktop / "patches/helper-parity.json").read_text())
        self.assertIsNone(manifest["files"][0]["after"])
        self.assert_clean_apply()

    def test_drift_aborts_before_any_target_or_manifest_write(self):
        self.initial()
        self.write(self.source, "helper/src/aaa.rs", "new\n")
        self.write(self.vendor, "helper/src/example.rs", "human edit\n")
        old = (self.desktop / "patches/helper-parity.json").read_bytes()
        with self.assertRaisesRegex(RuntimeError, "Preserve local edits"):
            OVERLAY.export(self.desktop, True)
        self.assertFalse((self.vendor / "helper/src/aaa.rs").exists())
        self.assertEqual((self.desktop / "patches/helper-parity.json").read_bytes(), old)

    def test_empty_and_no_newline_additions_match_clean_apply(self):
        for value in ["", "no final newline"]:
            with self.subTest(value=value):
                self.write(self.source, "helper/src/new.rs", value)
                OVERLAY.export(self.desktop, False)
                self.write(self.vendor, "helper/src/example.rs", "generated\n")
                self.write(self.vendor, "helper/src/new.rs", value)
                self.assert_clean_apply()
                import shutil
                shutil.rmtree(self.root / "clean")


if __name__ == "__main__":
    unittest.main()
