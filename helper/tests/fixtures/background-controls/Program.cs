using System;
using System.Drawing;
using System.Windows.Forms;

namespace BackgroundControlsFixture
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool isSentinel = args.Length > 0 && args[0].Equals("--sentinel", StringComparison.OrdinalIgnoreCase);

            if (isSentinel)
            {
                Application.Run(new SentinelForm());
            }
            else
            {
                Application.Run(new TargetForm());
            }
        }
    }

    public class SentinelForm : Form
    {
        public TextBox SentinelInput { get; private set; }

        public SentinelForm()
        {
            this.Text = "Aevra Foreground Sentinel";
            this.Size = new Size(400, 300);
            this.StartPosition = FormStartPosition.CenterScreen;

            var lbl = new Label
            {
                Text = "Foreground Sentinel (Receives Focus):",
                Location = new Point(20, 20),
                AutoSize = true
            };
            this.Controls.Add(lbl);

            SentinelInput = new TextBox
            {
                Name = "txtSentinel",
                Location = new Point(20, 50),
                Size = new Size(340, 30),
                Text = "SENTINEL_INITIAL"
            };
            this.Controls.Add(SentinelInput);
        }
    }

    public class TargetForm : Form
    {
        public Button InvokeButton { get; private set; }
        public Button DialogButton { get; private set; }
        public TextBox EditableText { get; private set; }
        public TextBox ReadOnlyText { get; private set; }
        public TextBox PasswordText { get; private set; }
        public ListBox SelectionList { get; private set; }
        public CheckBox ToggleCheck { get; private set; }
        public Label StatusLabel { get; private set; }

        public TargetForm()
        {
            this.Text = "Aevra Background Target Fixture";
            this.Size = new Size(450, 480);
            this.StartPosition = FormStartPosition.Manual;
            this.Location = new Point(100, 100);

            int y = 20;

            InvokeButton = new Button
            {
                Name = "btnInvoke",
                Text = "Invoke Target",
                Location = new Point(20, y),
                Size = new Size(160, 35)
            };
            InvokeButton.Click += (s, e) => { StatusLabel.Text = "Invoked"; };
            this.Controls.Add(InvokeButton);

            DialogButton = new Button
            {
                Name = "btnDialog",
                Text = "Open Modal Dialog",
                Location = new Point(200, y),
                Size = new Size(160, 35)
            };
            DialogButton.Click += (s, e) => {
                var popup = new Form
                {
                    Text = "Modal Dialog",
                    Size = new Size(250, 120),
                    StartPosition = FormStartPosition.CenterParent
                };
                popup.Show(this);
            };
            this.Controls.Add(DialogButton);

            y += 50;

            this.Controls.Add(new Label { Text = "Editable Text:", Location = new Point(20, y), AutoSize = true });
            EditableText = new TextBox
            {
                Name = "txtEditable",
                Text = "Initial Text",
                Location = new Point(20, y + 20),
                Size = new Size(340, 25)
            };
            this.Controls.Add(EditableText);

            y += 55;

            this.Controls.Add(new Label { Text = "Read-Only Text:", Location = new Point(20, y), AutoSize = true });
            ReadOnlyText = new TextBox
            {
                Name = "txtReadOnly",
                Text = "Read-Only Value",
                ReadOnly = true,
                Location = new Point(20, y + 20),
                Size = new Size(340, 25)
            };
            this.Controls.Add(ReadOnlyText);

            y += 55;

            this.Controls.Add(new Label { Text = "Password Text:", Location = new Point(20, y), AutoSize = true });
            PasswordText = new TextBox
            {
                Name = "txtPassword",
                Text = "Secret123",
                UseSystemPasswordChar = true,
                Location = new Point(20, y + 20),
                Size = new Size(340, 25)
            };
            this.Controls.Add(PasswordText);

            y += 55;

            this.Controls.Add(new Label { Text = "Selection List:", Location = new Point(20, y), AutoSize = true });
            SelectionList = new ListBox
            {
                Name = "lstItems",
                Location = new Point(20, y + 20),
                Size = new Size(200, 60)
            };
            SelectionList.Items.AddRange(new object[] { "Item Alpha", "Item Beta", "Item Gamma" });
            this.Controls.Add(SelectionList);

            y += 90;

            ToggleCheck = new CheckBox
            {
                Name = "chkToggle",
                Text = "Tri-state Toggle CheckBox",
                ThreeState = true,
                CheckState = CheckState.Unchecked,
                Location = new Point(20, y),
                Size = new Size(250, 25)
            };
            this.Controls.Add(ToggleCheck);

            y += 35;

            StatusLabel = new Label
            {
                Name = "lblStatus",
                Text = "Ready",
                Location = new Point(20, y),
                AutoSize = true
            };
            this.Controls.Add(StatusLabel);
        }
    }
}
