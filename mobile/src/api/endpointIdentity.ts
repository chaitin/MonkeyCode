import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'react-native-quick-crypto';

const MACHINE_ID_KEY = 'monkeycode.endpoint.machine_id';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let current: Promise<string> | null = null;

export function getOrCreateEndpointMachineId(): Promise<string> {
  if (!current) current = loadEndpointMachineId();
  return current;
}

async function loadEndpointMachineId(): Promise<string> {
  const stored = await SecureStore.getItemAsync(MACHINE_ID_KEY);
  if (stored && UUID_PATTERN.test(stored)) return stored;
  const machineId = randomUUID();
  await SecureStore.setItemAsync(MACHINE_ID_KEY, machineId, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return machineId;
}
