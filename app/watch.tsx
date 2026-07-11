import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Text,
  Platform,
  BackHandler,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';

const COOKIE_CACHE_KEY = 'netflixy_cookie_cache';
const NETFLIX_URL = 'https://www.netflix.com';

interface ParsedCookie {
  domain: string;
  path: string;
  name: string;
  value: string;
  secure: boolean;
  httpOnly: boolean;
  expiry: number;
}

function parseNetscapeCookies(raw: string): ParsedCookie[] {
  const cookies: ParsedCookie[] = [];
  for (const line of raw.split('\n')) {
    let t = line.trim();
    if (!t) continue;
    let httpOnly = false;
    if (t.startsWith('#HttpOnly_')) {
      t = t.slice('#HttpOnly_'.length);
      httpOnly = true;
    } else if (t.startsWith('#')) {
      continue;
    }
    const parts = t.split('\t');
    if (parts.length < 7) continue;
    const [domain, , path, secureStr, expiryStr, name, ...valParts] = parts;
    cookies.push({
      domain,
      path,
      name,
      value: valParts.join('\t'),
      secure: secureStr === 'TRUE',
      httpOnly,
      expiry: parseInt(expiryStr, 10) || 0,
    });
  }
  return cookies;
}

function buildCookieHeader(cookies: ParsedCookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

function buildJSInjection(cookies: ParsedCookie[]): string {
  // Only inject non-HttpOnly cookies via JS (HttpOnly ones can't be set this way)
  const nonHttp = cookies.filter((c) => !c.httpOnly);
  if (nonHttp.length === 0) return 'true;';
  const assignments = nonHttp
    .map((c) => {
      const exp = c.expiry > 0 ? new Date(c.expiry * 1000).toUTCString() : '';
      const parts = [`${c.name}=${c.value}`, `path=${c.path || '/'}`];
      if (exp) parts.push(`expires=${exp}`);
      if (c.secure) parts.push('SameSite=None; Secure');
      return `try{document.cookie=${JSON.stringify(parts.join('; '))};}catch(e){}`;
    })
    .join('\n');
  return `(function(){${assignments}})();true;`;
}

async function injectCookiesNative(cookies: ParsedCookie[]): Promise<{ ok: boolean; count: number; error?: string }> {
  // Dynamic import so the module error doesn't crash in Expo Go
  let CookieManager: any;
  try {
    const mod = require('@react-native-cookies/cookies');
    CookieManager = mod.default ?? mod;
    if (typeof CookieManager?.set !== 'function') throw new Error('Not a function');
  } catch {
    return { ok: false, count: 0, error: 'native_unavailable' };
  }

  try {
    await CookieManager.clearAll(Platform.OS === 'ios');
  } catch {}

  let set = 0;
  const expiresDefault = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  for (const cookie of cookies) {
    const domain = cookie.domain.startsWith('.') ? cookie.domain : `.${cookie.domain}`;
    const expires = cookie.expiry > 0
      ? new Date(cookie.expiry * 1000).toISOString()
      : expiresDefault;

    // Use iOS WKWebView-compatible cookie store when on iOS
    const useWebKit = Platform.OS === 'ios';

    try {
      await CookieManager.set(
        'https://www.netflix.com',
        {
          name: cookie.name,
          value: cookie.value,
          domain,
          path: cookie.path || '/',
          version: '1',
          expires,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
        },
        useWebKit,
      );
      set++;
    } catch {}
  }

  // Android requires explicit flush to persist cookies to WebView store
  if (Platform.OS === 'android') {
    try {
      await CookieManager.flush();
    } catch {}
  }

  return { ok: set > 0, count: set };
}

export default function WatchScreen() {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [webLoading, setWebLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState('Loading session…');
  const [cookieHeader, setCookieHeader] = useState('');
  const [jsInjection, setJsInjection] = useState('true;');

  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(COOKIE_CACHE_KEY);
      if (!raw) {
        setError('No session found.\nGo back and tap Refresh.');
        return;
      }

      const cookies = parseNetscapeCookies(raw);
      if (cookies.length === 0) {
        setError('Could not read cookies from your API.\nGo back and try again.');
        return;
      }

      setStatusMsg(`Found ${cookies.length} cookies — injecting…`);

      // Prepare header + JS injection as belt-and-suspenders
      setCookieHeader(buildCookieHeader(cookies));
      setJsInjection(buildJSInjection(cookies));

      // Try native injection (works in native builds, silently unavailable in Expo Go)
      const result = await injectCookiesNative(cookies);

      if (result.error === 'native_unavailable') {
        // Native module not linked — Expo Go or dev environment
        // Proceed with header + JS fallback only (HttpOnly cookies won't work)
        setStatusMsg(`Header injection only (${cookies.length} cookies)…`);
      } else if (result.ok) {
        setStatusMsg(`Injected ${result.count}/${cookies.length} cookies natively`);
      } else {
        setStatusMsg(`Injection may have failed — loading anyway`);
      }

      // Small delay so the cookie store is settled before WebView mounts
      await new Promise((r) => setTimeout(r, 400));
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack && webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }
      router.back();
      return true;
    });
    return () => sub.remove();
  }, [canGoBack]);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: topPad }]}>
        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => {
            if (canGoBack && webViewRef.current) {
              webViewRef.current.goBack();
            } else {
              router.back();
            }
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Feather name="chevron-left" size={24} color="#fff" />
        </TouchableOpacity>

        <Text style={styles.barLogo}>
          <Text style={{ color: '#e50914' }}>N</Text>ETFLIX
        </Text>

        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Feather name="x" size={22} color="#888" />
        </TouchableOpacity>
      </View>

      {ready && (
        <WebView
          ref={webViewRef}
          source={{
            uri: NETFLIX_URL,
            headers: cookieHeader ? { Cookie: cookieHeader } : {},
          }}
          injectedJavaScriptBeforeContentLoaded={jsInjection}
          style={styles.webview}
          onNavigationStateChange={(nav: WebViewNavigation) =>
            setCanGoBack(nav.canGoBack)
          }
          onLoadStart={() => setWebLoading(true)}
          onLoadEnd={() => setWebLoading(false)}
          onError={() => {
            setWebLoading(false);
            setError('Netflix failed to load.\nCheck your internet connection.');
          }}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo
          userAgent="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36"
        />
      )}

      {!ready && !error && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#e50914" />
          <Text style={styles.centerText}>{statusMsg}</Text>
        </View>
      )}

      {ready && webLoading && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#e50914" />
        </View>
      )}

      {error && (
        <View style={styles.center}>
          <Feather name="alert-circle" size={40} color="#555" />
          <Text style={styles.centerText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => router.back()}>
            <Text style={styles.retryText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#141414' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#141414',
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  navBtn: { padding: 6, width: 40, alignItems: 'center' },
  barLogo: { fontSize: 16, fontWeight: '900', color: '#fff', letterSpacing: 1 },
  webview: { flex: 1, backgroundColor: '#141414' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 32,
  },
  centerText: {
    color: '#888',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(20,20,20,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryBtn: {
    backgroundColor: '#e50914',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 4,
  },
  retryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
