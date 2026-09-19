# Aevra Background Controls Test Fixture

A dedicated, isolated Windows Forms test fixture for validating background UI Automation control coexistence without stealing focus or injecting foreground inputs.

## Controls Exposed
- **Button (`btnInvoke`)**: Supports `InvokePattern`. Updates status label on click.
- **Button (`btnDialog`)**: Opens a modal MessageBox dialog to test focus change detection.
- **TextBox (`txtEditable`)**: Supports `ValuePattern`. Fully editable text field.
- **TextBox (`txtReadOnly`)**: Supports `ValuePattern` with `CurrentIsReadOnly == true`.
- **TextBox (`txtPassword`)**: Marked with `UseSystemPasswordChar == true`.
- **ListBox (`lstItems`)**: Contains selectable items ("Item Alpha", "Item Beta", "Item Gamma") supporting `SelectionItemPattern`.
- **CheckBox (`chkToggle`)**: Tri-state checkbox supporting `TogglePattern`.

## Modes
- **Target Mode** (default): Runs the full test form above.
- **Sentinel Mode** (`--sentinel`): Runs a foreground sentinel window containing a focused TextBox to verify that background actions never leak keystrokes or cursor events into active foreground applications.

## Building
```powershell
dotnet build helper/tests/fixtures/background-controls/background-controls.csproj -c Release
```
Outputs executable to `bin/Release/net8.0-windows/background-controls.exe`.
