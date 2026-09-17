import { runDriverConformance } from './conformance.js';
import { FakeDriver } from './fake-driver.js';

runDriverConformance('FakeDriver', async () => {
  const driver = new FakeDriver();
  return {
    driver,
    connectOptions: { transport: 'extension' },
    startUrl: 'https://example.com/invoices',
    buttonName: 'New invoice',
    textFieldRole: 'textbox',
    scopedSelector: 'h1',
    scopedExpectation: /Invoices/,
    teardown: () => driver.disconnect(),
  };
});
