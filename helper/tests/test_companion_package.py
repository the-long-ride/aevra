import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

SPEC = importlib.util.spec_from_file_location("companion_package", Path(__file__).parents[1] / "wayland/package-companion.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

class CompanionPackageTests(unittest.TestCase):
    def test_archive_contains_only_the_production_companion_and_is_reproducible(self):
        with tempfile.TemporaryDirectory() as directory:
            target = MODULE.package(Path(directory))
            before = target.read_bytes()
            with zipfile.ZipFile(target) as archive:
                self.assertEqual(sorted(archive.namelist()), sorted(MODULE.FILES))
                self.assertNotIn(b"method==='Fixture'", archive.read("extension.js"))
                self.assertIn(b"isCallerAllowed", archive.read("extension.js"))
                self.assertNotIn("gnome_control.js", archive.namelist())
            MODULE.package(Path(directory))
            self.assertEqual(before, target.read_bytes())

    def test_kde_source_package_is_reproducible_and_builds_production_by_default(self):
        with tempfile.TemporaryDirectory() as directory:
            target = MODULE.package_kde(Path(directory))
            before = target.read_bytes()
            with zipfile.ZipFile(target) as archive:
                self.assertEqual(sorted(archive.namelist()), sorted(MODULE.KDE_FILES))
                self.assertIn(b'AEVRA_NATIVE_FIXTURE "Include isolated test-only controls; NEVER distribute" OFF', archive.read('CMakeLists.txt'))
                self.assertNotIn('aevra-desktop.so', archive.namelist())
            MODULE.package_kde(Path(directory))
            self.assertEqual(before, target.read_bytes())

if __name__ == "__main__":
    unittest.main()
