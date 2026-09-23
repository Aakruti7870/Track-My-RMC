import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useAuth } from '../src/auth/AuthContext';
import { useRouter } from 'expo-router';

export default function RoleHomeScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.welcome}>Welcome, {user?.full_name || 'User'}</Text>
      <Text style={styles.roleTag}>Role: {user?.role?.toUpperCase()}</Text>
      <Text style={styles.info}>Phone: {user?.phone}</Text>
      {user?.email && <Text style={styles.info}>Email: {user?.email}</Text>}
      <Text style={styles.info}>KYC Status: {user?.kyc_status?.toUpperCase()}</Text>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  welcome: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#F8FAFC',
    marginBottom: 8,
  },
  roleTag: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#38BDF8',
    backgroundColor: '#1E293B',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    marginBottom: 20,
  },
  info: {
    fontSize: 14,
    color: '#94A3B8',
    marginBottom: 6,
  },
  logoutButton: {
    marginTop: 32,
    backgroundColor: '#EF4444',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
  },
  logoutText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
