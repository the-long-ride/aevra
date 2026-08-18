export function selectedPlatformMatchers(catalog, platform) {
  return catalog
    .filter(
      (item) =>
        Array.isArray(item.platforms) && item.platforms.includes(platform),
    )
    .map((item) => item.matcher);
}
