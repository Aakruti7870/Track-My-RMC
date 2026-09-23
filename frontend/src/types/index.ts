export type UserRole =
  | 'customer'
  | 'driver'
  | 'dispatcher'
  | 'operator'
  | 'supervisor'
  | 'quality_engineer'
  | 'store_manager'
  | 'accountant'
  | 'fleet_manager'
  | 'owner'
  | 'admin';

export interface User {
  id: string;
  phone: string;
  email?: string;
  full_name: string;
  role: UserRole;
  kyc_status: 'unverified' | 'pending' | 'verified' | 'rejected';
  verified_name?: string;
}

export interface RmcPlant {
  id: string;
  name: string;
  code: string;
  latitude: number;
  longitude: number;
  address_line: string;
  city: string;
  state: string;
  pincode: string;
  contact_phone: string;
  contact_email?: string;
  capacity_m3_per_hr: number;
  rating: number;
  is_active: boolean;
}

export interface Order {
  id: string;
  order_number: string;
  customer_id: string;
  plant_id: string;
  site_id: string;
  concrete_grade: string;
  total_quantity_m3: number;
  delivery_date: string;
  delivery_time_slot: string;
  pump_required: boolean;
  special_instructions?: string;
  total_amount: number;
  tax_amount: number;
  status: 'pending' | 'accepted' | 'batching' | 'dispatched' | 'in_transit' | 'delivered' | 'completed' | 'cancelled';
  payment_status: 'unpaid' | 'partial' | 'paid';
  created_at: string;
}

export interface OrderLoad {
  id: string;
  order_id: string;
  load_number: number;
  mixer_id?: string;
  driver_id?: string;
  quantity_m3: number;
  status: 'planned' | 'batching' | 'dispatched' | 'arrived' | 'pouring' | 'completed';
  dispatched_at?: string;
  arrived_at?: string;
  pour_completed_at?: string;
}

export interface Challan {
  id: string;
  load_id: string;
  challan_number: string;
  plant_code: string;
  customer_name: string;
  site_address: string;
  concrete_grade: string;
  quantity_m3: number;
  slump_mm: number;
  water_cement_ratio: number;
  batch_time: string;
  mixer_number: string;
  driver_name: string;
  digital_signature?: string;
  receiver_name?: string;
  receiver_phone?: string;
  status: string;
}
