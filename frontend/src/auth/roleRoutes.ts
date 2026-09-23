import { UserRole } from '../types';

export const getRoleHomeRoute = (role: UserRole): string => {
  switch (role) {
    case 'customer':
      return '/customer';
    case 'driver':
      return '/driver';
    case 'dispatcher':
      return '/dispatcher';
    case 'operator':
      return '/operator';
    case 'supervisor':
      return '/supervisor';
    case 'quality_engineer':
      return '/quality_engineer';
    case 'store_manager':
      return '/store_manager';
    case 'accountant':
      return '/accountant';
    case 'fleet_manager':
      return '/fleet_manager';
    case 'owner':
      return '/owner';
    case 'admin':
      return '/admin';
    default:
      return '/login';
  }
};
