import { fireEvent, render, screen } from '@testing-library/react-native';

import { ProfileScreen } from '@/components/profile-screen';

const mockVerification = { has_face: false, has_id: false, photo_version: '-', face_check: null, notes: '', vehicle_type: null as number | null, verified: false };
const mockSaveVehicle = jest.fn();
const mockIdle = { mutate: jest.fn(), isPending: false, error: null };
jest.mock('@/hooks/queries', () => ({
  useDriverVerification: () => ({ data: mockVerification, isPending: false, error: null }),
  useSaveVerificationNotes: () => mockIdle,
  useUploadVerificationPhoto: () => mockIdle,
  useSaveVehicleType: () => ({ ...mockIdle, mutate: mockSaveVehicle }),
}));
jest.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    state: { status: 'signedIn', user: { id: 1, name: 'Dan', email: 'dan@test.com', phone: '09170000001', role: 'driver' } },
    signOut: jest.fn(),
  }),
}));
jest.mock('@/components/driver/face-camera', () => ({ FaceCamera: () => null }));

beforeEach(() => {
  mockSaveVehicle.mockClear();
  mockVerification.vehicle_type = null;
  mockVerification.verified = false;
});

it('shows the vehicle under the phone and saves the picked type', async () => {
  await render(<ProfileScreen />);
  expect(screen.getByText('Vehicle')).toBeTruthy();
  expect(screen.getByText('Not set')).toBeTruthy();
  fireEvent.press(screen.getByRole('radio', { name: 'Tricycle' }));
  expect(mockSaveVehicle).toHaveBeenCalledWith(3);
});

it('locks the vehicle once verified', async () => {
  mockVerification.vehicle_type = 2;
  mockVerification.verified = true;
  await render(<ProfileScreen />);
  expect(screen.getByText('Motorcycle')).toBeTruthy();
  expect(screen.queryByRole('radio')).toBeNull();
});
