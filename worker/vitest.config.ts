import { workersConfig } from './vitest.shared';

// v1 suites: each test gets fresh storage.
export default workersConfig({ isolatedStorage: true, exclude: ['test/v2/**'] });
