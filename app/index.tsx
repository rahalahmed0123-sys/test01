import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

const API_URL_KEY = 'netflixy_api_url';
const COOKIE_CACHE_KEY = 'netflixy_cookie_cache';
const COOKIE_CACHE_TS_KEY = 'netflixy_cookie_cache_ts';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

type Status = 'idle' | 'checking' | 'ready' | 'error' | 'no_cookie';

interface AccessResponse {
  found: boolean;
  cookieValue?: string;
  label?: string;
}

function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim().replace(/\/$/, ''));
    // Enforce HTTPS (allow localhost/127.0.0.1 for dev)
    const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !isLocal) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [apiUrl, setApiUrl] = useState('');
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [statusLabel, setStatusLabel] = useState('');
  const [cookieCount, setCookieCount] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);
  const [urlError, setUrlError] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(API_URL_KEY).then((url) => {
      if (url) {
        setSavedUrl(url);
        checkCookieStatus(url);
      }
    });
  }, []);

  const checkCookieStatus = useCallback(async (url: string, forceRefresh = false) => {
    setStatus('checking');
    setStatusLabel('');

    // Check cache first
    if (!forceRefresh) {
      try {
        const [cachedCookie, cachedTs] = await Promise.all([
          AsyncStorage.getItem(COOKIE_CACHE_KEY),
          AsyncStorage.getItem(COOKIE_CACHE_TS_KEY),
        ]);
        if (cachedCookie && cachedTs) {
          const age = Date.now() - parseInt(cachedTs, 10);
          if (age < CACHE_TTL_MS) {
            const count = parseNetscapeCookies(cachedCookie).length;
            setCookieCount(count || 1);
            setStatusLabel('Ready · cached');
            setStatus('ready');
            return;
          }
        }
      } catch {}
    }

    try {
      const res = await fetch(`${url}/api/access`, {
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: AccessResponse = await res.json();

      if (data.found && data.cookieValue) {
        await AsyncStorage.setItem(COOKIE_CACHE_KEY, data.cookieValue);
        await AsyncStorage.setItem(COOKIE_CACHE_TS_KEY, String(Date.now()));
        const parsed = parseNetscapeCookies(data.cookieValue);
        setCookieCount(parsed.length || 1);
        setStatusLabel(data.label || '');
        setStatus('ready');
      } else {
        setStatus('no_cookie');
        setStatusLabel('No active session on server');
      }
    } catch {
      setStatus('error');
      setStatusLabel('Cannot reach API');
    }
  }, []);

  const handleSaveUrl = async () => {
    const normalized = normalizeUrl(apiUrl);
    if (!normalized) {
      setUrlError(true);
      return;
    }
    setUrlError(false);
    await AsyncStorage.setItem(API_URL_KEY, normalized);
    setSavedUrl(normalized);
    checkCookieStatus(normalized);
  };

  const handleEnterNetflix = async () => {
    if (status !== 'ready') return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/watch');
  };

  const handleReset = async () => {
    await AsyncStorage.multiRemove([API_URL_KEY, COOKIE_CACHE_KEY, COOKIE_CACHE_TS_KEY]);
    setSavedUrl(null);
    setApiUrl('');
    setStatus('idle');
    setStatusLabel('');
  };

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  if (!savedUrl) {
    return (
      <View style={[styles.container, { paddingTop: topPad + 20, paddingBottom: botPad + 20 }]}>
        <StatusBar barStyle="light-content" backgroundColor="#141414" />
        <View style={styles.logoRow}>
          <Text style={styles.logoN}>N</Text>
          <Text style={styles.logoRest}>ETFLIXY</Text>
        </View>

        <View style={styles.setupCard}>
          <Text style={styles.setupTitle}>Connect your API</Text>
          <Text style={styles.setupSub}>
            Enter your Netflixy API server URL to load your Netflix session.
          </Text>
          <TextInput
            style={[styles.input, inputFocused && styles.inputFocused, urlError && styles.inputError]}
            placeholder="https://your-api.replit.app"
            placeholderTextColor="#555"
            value={apiUrl}
            onChangeText={(t) => { setApiUrl(t); setUrlError(false); }}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
            onSubmitEditing={handleSaveUrl}
          />
          {urlError && <Text style={styles.errorText}>Enter a valid HTTPS URL (https://...)</Text>}
          <TouchableOpacity style={styles.primaryBtn} onPress={handleSaveUrl} activeOpacity={0.8}>
            <Text style={styles.primaryBtnText}>Connect</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: topPad + 20, paddingBottom: botPad + 20 }]}>
      <StatusBar barStyle="light-content" backgroundColor="#141414" />
      <View style={styles.logoRow}>
        <Text style={styles.logoN}>N</Text>
        <Text style={styles.logoRest}>ETFLIXY</Text>
      </View>

      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          {status === 'checking' && (
            <View style={[styles.dot, styles.dotPulse]} />
          )}
          {status === 'ready' && (
            <View style={[styles.dot, styles.dotGreen]} />
          )}
          {(status === 'error' || status === 'no_cookie') && (
            <View style={[styles.dot, styles.dotGrey]} />
          )}
          {status === 'idle' && (
            <View style={[styles.dot, styles.dotGrey]} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.statusText}>
              {status === 'checking' && 'Checking session…'}
              {status === 'ready' && `Session ready${cookieCount > 1 ? ` · ${cookieCount} cookies` : ''}`}
              {status === 'error' && 'Cannot reach API'}
              {status === 'no_cookie' && 'No active session'}
              {status === 'idle' && 'Not connected'}
            </Text>
            {statusLabel ? <Text style={styles.statusSub}>{statusLabel}</Text> : null}
          </View>
          {status === 'checking' && (
            <ActivityIndicator size="small" color="#e50914" />
          )}
        </View>
        <Text style={styles.apiUrlText} numberOfLines={1}>{savedUrl}</Text>
      </View>

      <TouchableOpacity
        style={[styles.primaryBtn, styles.bigBtn, status !== 'ready' && styles.btnDisabled]}
        onPress={handleEnterNetflix}
        disabled={status !== 'ready'}
        activeOpacity={0.8}
      >
        <Text style={styles.primaryBtnText}>
          {status === 'checking' ? 'Loading…' : 'Watch Netflix'}
        </Text>
      </TouchableOpacity>

      <View style={styles.footerRow}>
        <TouchableOpacity
          style={styles.ghostBtn}
          onPress={() => savedUrl && checkCookieStatus(savedUrl, true)}
          activeOpacity={0.7}
        >
          <Text style={styles.ghostBtnText}>Refresh</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ghostBtn} onPress={handleReset} activeOpacity={0.7}>
          <Text style={[styles.ghostBtnText, { color: '#666' }]}>Change API</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function parseNetscapeCookies(raw: string): { name: string; value: string; domain: string; path: string }[] {
  const cookies: { name: string; value: string; domain: string; path: string }[] = [];
  for (const line of raw.split('\n')) {
    let trimmed = line.trim();
    if (!trimmed) continue;
    // Strip HttpOnly marker (e.g. "#HttpOnly_.netflix.com") — keep the rest
    if (trimmed.startsWith('#HttpOnly_')) {
      trimmed = trimmed.slice('#HttpOnly_'.length);
    } else if (trimmed.startsWith('#')) {
      continue; // true comment, skip
    }
    const parts = trimmed.split('\t');
    if (parts.length < 7) continue;
    const [domain, , path, , , name, ...valueParts] = parts;
    cookies.push({ domain, path, name, value: valueParts.join('\t') });
  }
  return cookies;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#141414',
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 40,
  },
  logoN: {
    fontSize: 42,
    fontWeight: '900',
    color: '#e50914',
    letterSpacing: -1,
  },
  logoRest: {
    fontSize: 42,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: -1,
  },
  setupCard: {
    width: '100%',
    backgroundColor: '#1f1f1f',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  setupTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  setupSub: {
    color: '#999',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 16,
  },
  input: {
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    color: '#fff',
    fontSize: 14,
    padding: 12,
    marginBottom: 12,
  },
  inputFocused: {
    borderColor: '#e50914',
  },
  inputError: {
    borderColor: '#ef4444',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 12,
    marginTop: -8,
    marginBottom: 10,
  },
  primaryBtn: {
    backgroundColor: '#e50914',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    width: '100%',
  },
  bigBtn: {
    marginTop: 8,
  },
  btnDisabled: {
    opacity: 0.4,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  statusCard: {
    width: '100%',
    backgroundColor: '#1f1f1f',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    marginBottom: 16,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotGreen: {
    backgroundColor: '#22c55e',
  },
  dotGrey: {
    backgroundColor: '#555',
  },
  dotPulse: {
    backgroundColor: '#e50914',
  },
  statusText: {
    color: '#ccc',
    fontSize: 14,
    fontWeight: '600',
  },
  statusSub: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },
  apiUrlText: {
    color: '#444',
    fontSize: 11,
    marginTop: 4,
  },
  footerRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 20,
  },
  ghostBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  ghostBtnText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '500',
  },
});
