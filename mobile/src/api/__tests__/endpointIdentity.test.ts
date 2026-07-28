const mockGetItemAsync = jest.fn();
const mockSetItemAsync = jest.fn();

jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => mockGetItemAsync(...args),
  setItemAsync: (...args: unknown[]) => mockSetItemAsync(...args),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only',
}));

jest.mock('react-native-quick-crypto', () => ({
  randomUUID: () => '11111111-1111-4111-8111-111111111111',
}));

beforeEach(() => {
  jest.resetModules();
  mockGetItemAsync.mockReset();
  mockSetItemAsync.mockReset();
});

test('首次安装生成 UUID 并保存到系统安全存储', async () => {
  mockGetItemAsync.mockResolvedValue(null);
  const { getOrCreateEndpointMachineId } = require('../endpointIdentity');

  await expect(getOrCreateEndpointMachineId()).resolves.toBe('11111111-1111-4111-8111-111111111111');
  expect(mockSetItemAsync).toHaveBeenCalledWith(
    'monkeycode.endpoint.machine_id',
    '11111111-1111-4111-8111-111111111111',
    { keychainAccessible: 'device-only' },
  );
});

test('已有合法机器标识直接复用', async () => {
  mockGetItemAsync.mockResolvedValue('22222222-2222-4222-8222-222222222222');
  const { getOrCreateEndpointMachineId } = require('../endpointIdentity');

  await expect(getOrCreateEndpointMachineId()).resolves.toBe('22222222-2222-4222-8222-222222222222');
  expect(mockSetItemAsync).not.toHaveBeenCalled();
});
