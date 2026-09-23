import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/auth/AuthContext';
import { getRoleHomeRoute } from '../src/auth/roleRoutes';

export default function LoginScreen() {
  const [authMode, setAuthMode] = useState<'whatsapp' | 'staff_email' | 'totp'>('whatsapp');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [plantCode, setPlantCode] = useState('');
  const [otp, setOtp] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [step, setStep] = useState<'input' | 'verify'>('input');
  const [loading, setLoading] = useState(false);

  const { sendWhatsAppOtp, verifyWhatsAppOtp, sendEmailOtp, verifyEmailOtp, verifyTotpLogin } = useAuth();
  const router = useRouter();

  const handleSendCode = async () => {
    setLoading(true);
    try {
      if (authMode === 'whatsapp') {
        if (!phone.trim()) {
          Alert.alert('Error', 'Please enter your 10-digit mobile number');
          return;
        }
        await sendWhatsAppOtp(phone);
        setStep('verify');
        Alert.alert('Code Sent', 'A verification code has been dispatched to your WhatsApp.');
      } else if (authMode === 'staff_email') {
        if (!email.trim()) {
          Alert.alert('Error', 'Please enter your staff/owner email address');
          return;
        }
        await sendEmailOtp(email, plantCode ? plantCode : undefined);
        setStep('verify');
        Alert.alert('Code Sent', 'A verification code has been dispatched to your email.');
      }
    } catch (err: any) {
      Alert.alert('Verification Failed', err.message || 'Unable to dispatch verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setLoading(true);
    try {
      let loggedUser;
      if (authMode === 'whatsapp') {
        loggedUser = await verifyWhatsAppOtp(phone, otp);
      } else if (authMode === 'staff_email') {
        loggedUser = await verifyEmailOtp(email, otp, plantCode ? plantCode : undefined);
      } else if (authMode === 'totp') {
        loggedUser = await verifyTotpLogin(email || phone, totpCode);
      }

      if (loggedUser) {
        router.replace(getRoleHomeRoute(loggedUser.role) as any);
      }
    } catch (err: any) {
      Alert.alert('Authentication Error', err.message || 'Invalid or expired verification code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>TrackMyRMC</Text>
      <Text style={styles.subtitle}>Concrete Delivery & Batching Operations</Text>

      {/* Auth Mode Toggle */}
      <View style={styles.modeContainer}>
        <TouchableOpacity
          style={[styles.modeButton, authMode === 'whatsapp' && styles.modeButtonActive]}
          onPress={() => { setAuthMode('whatsapp'); setStep('input'); }}
        >
          <Text style={[styles.modeText, authMode === 'whatsapp' && styles.modeTextActive]}>
            Customer / Driver
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.modeButton, authMode === 'staff_email' && styles.modeButtonActive]}
          onPress={() => { setAuthMode('staff_email'); setStep('input'); }}
        >
          <Text style={[styles.modeText, authMode === 'staff_email' && styles.modeTextActive]}>
            Staff / Owner
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.modeButton, authMode === 'totp' && styles.modeButtonActive]}
          onPress={() => { setAuthMode('totp'); setStep('input'); }}
        >
          <Text style={[styles.modeText, authMode === 'totp' && styles.modeTextActive]}>
            Authenticator
          </Text>
        </TouchableOpacity>
      </View>

      {/* WhatsApp Input */}
      {authMode === 'whatsapp' && step === 'input' && (
        <View style={styles.card}>
          <Text style={styles.label}>WhatsApp Mobile Number</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 9823012345"
            placeholderTextColor="#64748B"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
          />
          <TouchableOpacity style={styles.actionButton} onPress={handleSendCode} disabled={loading}>
            {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.actionButtonText}>Send WhatsApp OTP</Text>}
          </TouchableOpacity>
        </View>
      )}

      {/* Staff Email Input */}
      {authMode === 'staff_email' && step === 'input' && (
        <View style={styles.card}>
          <Text style={styles.label}>Staff / Owner Email</Text>
          <TextInput
            style={styles.input}
            placeholder="dispatcher@trackmyrmc.com"
            placeholderTextColor="#64748B"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />
          <Text style={styles.label}>Plant Code (Optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. PUN-01"
            placeholderTextColor="#64748B"
            autoCapitalize="characters"
            value={plantCode}
            onChangeText={setPlantCode}
          />
          <TouchableOpacity style={styles.actionButton} onPress={handleSendCode} disabled={loading}>
            {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.actionButtonText}>Send Email OTP</Text>}
          </TouchableOpacity>
        </View>
      )}

      {/* TOTP Mode */}
      {authMode === 'totp' && (
        <View style={styles.card}>
          <Text style={styles.label}>Staff Email / Username</Text>
          <TextInput
            style={styles.input}
            placeholder="admin@trackmyrmc.com"
            placeholderTextColor="#64748B"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />
          <Text style={styles.label}>6-Digit Code or Recovery Code</Text>
          <TextInput
            style={styles.input}
            placeholder="123456 or A1B2-C3D4"
            placeholderTextColor="#64748B"
            value={totpCode}
            onChangeText={setTotpCode}
          />
          <TouchableOpacity style={styles.actionButton} onPress={handleVerify} disabled={loading}>
            {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.actionButtonText}>Log In with TOTP</Text>}
          </TouchableOpacity>
        </View>
      )}

      {/* Verification Step for OTP */}
      {(authMode === 'whatsapp' || authMode === 'staff_email') && step === 'verify' && (
        <View style={styles.card}>
          <Text style={styles.label}>Enter 6-Digit Verification Code</Text>
          <TextInput
            style={[styles.input, styles.otpInput]}
            placeholder="------"
            placeholderTextColor="#64748B"
            keyboardType="number-pad"
            maxLength={6}
            value={otp}
            onChangeText={setOtp}
          />
          <TouchableOpacity style={styles.actionButton} onPress={handleVerify} disabled={loading}>
            {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.actionButtonText}>Verify & Continue</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryButton} onPress={() => setStep('input')}>
            <Text style={styles.secondaryButtonText}>Back to Mobile / Email</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#0F172A',
    padding: 24,
    justifyContent: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#38BDF8',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 32,
    marginTop: 4,
  },
  modeContainer: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 4,
    marginBottom: 20,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  modeButtonActive: {
    backgroundColor: '#0284C7',
  },
  modeText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '600',
  },
  modeTextActive: {
    color: '#FFFFFF',
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  label: {
    fontSize: 14,
    color: '#E2E8F0',
    marginBottom: 8,
    fontWeight: '500',
  },
  input: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#F8FAFC',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#475569',
    marginBottom: 16,
  },
  otpInput: {
    textAlign: 'center',
    letterSpacing: 8,
    fontSize: 24,
    fontWeight: 'bold',
  },
  actionButton: {
    backgroundColor: '#0284C7',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  secondaryButton: {
    marginTop: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#38BDF8',
    fontSize: 14,
  },
});
