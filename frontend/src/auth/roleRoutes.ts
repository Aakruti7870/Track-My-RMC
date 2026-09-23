import { UserRole } from '../types';

export const getRoleHomeRoute = (role: UserRole): string => {
  switch (role) {
    case 'customer':
      return '/role-home';
    case 'driver':
      return '/role-home';
    case 'dispatcher':
      return '/role-home';
    case 'operator':
      return '/role-home';
    case 'supervisor':
      return '/role-home';
    case 'quality_engineer':
      return '/role-home';
    case 'store_manager':
      return '/role-home';
    case 'accountant':
      return '/role-home';
    case 'fleet_manager':
      return '/role-home';
    case 'owner':
      return '/role-home';
    case 'admin':
      return '/role-home';
    default:
      return '/login';
  }
};
