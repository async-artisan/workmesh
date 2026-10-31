import { client } from './client';
export interface AuthResult {
  user: { id: string; email: string; name?: string | null; role: 'USER' | 'ADMIN' | 'SUPER_ADMIN' };
  accessToken: string;
  refreshToken: string;
}
export const authApi = {
  login: (data: { email: string; password: string }) =>
    client.post('/auth/login', data).then((value) => value as unknown as AuthResult),
  register: (data: { email: string; password: string; name?: string }) =>
    client.post('/auth/register', data).then((value) => value as unknown as AuthResult),
  profile: () => client.get('/auth/profile'),
  updateProfile: (data: { name?: string }) => client.patch('/auth/profile', data),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    client.patch('/auth/password', data),
  logout: (refreshToken: string) => client.post('/auth/logout', { refreshToken }),
};
