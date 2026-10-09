import { workersConfig } from './vitest.shared';

// v2 suites use WebSockets and Durable Object alarms, which isolated storage does not support.
// Tests isolate themselves with fresh users and a fresh shop/group per test.
export default workersConfig({ isolatedStorage: false, include: ['test/v2/**/*.test.ts'] });
