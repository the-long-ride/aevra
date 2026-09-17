import { runDesktopConformance } from './conformance.js';
import { FakeDesktopDriver } from './fake-driver.js';

runDesktopConformance('FakeDesktopDriver', async () => {
  const driver = new FakeDesktopDriver({
    capture: true,
    tree: true,
    attribution: true,
    input: true,
  });
  return { driver, buttonName: 'Save', teardown: () => driver.disconnect() };
});
