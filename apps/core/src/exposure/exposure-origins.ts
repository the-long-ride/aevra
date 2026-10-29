import type { RuntimeExposureWiring } from './runtime-wiring.js';

/** Origins the browser policy treats as Aevra's own surface, read lazily from the exposure. */
export function exposureOrigins(
  exposure:
    | Pick<
        RuntimeExposureWiring,
        'gatewayUrl' | 'publicUrl' | 'adminPublicUrl' | 'trustedAdminOrigins'
      >
    | undefined,
) {
  return [
    exposure?.gatewayUrl(),
    exposure?.publicUrl(),
    exposure?.adminPublicUrl(),
    ...(exposure?.trustedAdminOrigins() ?? []),
  ];
}
