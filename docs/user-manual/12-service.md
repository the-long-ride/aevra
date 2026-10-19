# Run as a service

For normal development, `aevra start --ui` keeps Aevra attached to a terminal.

For persistent use, install the supported user-level Aevra service and manage it with the `aevra service` commands shown by `aevra help`.

The service runs as the current user. Elevated execution is outside Aevra's normal execution model.

## Custom ports

```sh
aevra service install --basePort=50000
aevra service start
# To change a running service's selection:
aevra service restart --gp=50000 --up=51000 --mp=52000 --wp=53000
```

The service retains selected startup arguments for later starts and logons.
Without port flags, start/restart preserve the installed selection. Explicit flags
replace it; any omitted individual listener uses normal environment/default values.
Base and individual modes cannot be mixed. `stop` and `status` accept no startup
port flags. See [first start](02-first-start.md#custom-ports) for long flag names,
validation and pairing-port guidance.
