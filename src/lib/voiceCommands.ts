/**
 * Voice & Phone Commands Engine
 * Parses natural voice commands for web applications, phone features, and system actions:
 * - "open youtube", "open google", "open github", "open maps"
 * - "search youtube for lofi music"
 * - Phone commands:
 *   - "call [number/name]" (tel:)
 *   - "email [address]" (mailto:)
 *   - "sms [number]" (sms:)
 *   - "open camera" / "take photo"
 *   - "check battery" / "battery percentage"
 *   - "vibrate phone"
 *   - "set timer for 5 minutes"
 *   - "weather in [city]"
 *   - "latest news"
 */

export interface VoiceCommandResult {
  matched: boolean;
  action: 'open_url' | 'search' | 'phone_call' | 'email' | 'sms' | 'camera' | 'battery' | 'vibrate' | 'timer' | 'weather' | 'news';
  url?: string;
  targetName: string;
  feedbackSpeech: string;
  riskLevel: 'safe' | 'moderate' | 'sensitive';
  parameters?: Record<string, any>;
}

// Known web apps and services
const COMMAND_TARGETS: Record<string, { name: string; url: string; searchUrl?: (q: string) => string }> = {
  youtube: {
    name: 'YouTube',
    url: 'https://www.youtube.com',
    searchUrl: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  },
  google: {
    name: 'Google',
    url: 'https://www.google.com',
    searchUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  },
  github: {
    name: 'GitHub',
    url: 'https://www.github.com',
    searchUrl: (q) => `https://github.com/search?q=${encodeURIComponent(q)}`,
  },
  twitter: {
    name: 'X (Twitter)',
    url: 'https://x.com',
    searchUrl: (q) => `https://x.com/search?q=${encodeURIComponent(q)}`,
  },
  x: {
    name: 'X',
    url: 'https://x.com',
  },
  reddit: {
    name: 'Reddit',
    url: 'https://www.reddit.com',
    searchUrl: (q) => `https://www.reddit.com/search/?q=${encodeURIComponent(q)}`,
  },
  spotify: {
    name: 'Spotify',
    url: 'https://open.spotify.com',
    searchUrl: (q) => `https://open.spotify.com/search/${encodeURIComponent(q)}`,
  },
  netflix: {
    name: 'Netflix',
    url: 'https://www.netflix.com',
  },
  gmail: {
    name: 'Gmail',
    url: 'https://mail.google.com',
  },
  maps: {
    name: 'Google Maps',
    url: 'https://maps.google.com',
    searchUrl: (q) => `https://maps.google.com/maps?q=${encodeURIComponent(q)}`,
  },
  'google maps': {
    name: 'Google Maps',
    url: 'https://maps.google.com',
    searchUrl: (q) => `https://maps.google.com/maps?q=${encodeURIComponent(q)}`,
  },
  chatgpt: {
    name: 'ChatGPT',
    url: 'https://chatgpt.com',
  },
  wikipedia: {
    name: 'Wikipedia',
    url: 'https://www.wikipedia.org',
    searchUrl: (q) => `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(q)}`,
  },
  amazon: {
    name: 'Amazon',
    url: 'https://www.amazon.com',
    searchUrl: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
  },
  whatsapp: {
    name: 'WhatsApp Web',
    url: 'https://web.whatsapp.com',
  },
  linkedin: {
    name: 'LinkedIn',
    url: 'https://www.linkedin.com',
  },
  discord: {
    name: 'Discord',
    url: 'https://discord.com/app',
  },
};

/**
 * Parses user speech for phone actions, app launches, or search commands
 */
export function matchVoiceCommand(rawQuery: string): VoiceCommandResult | null {
  if (!rawQuery) return null;
  const q = rawQuery.trim().toLowerCase();

  // 1. Phone Call Command: "call [number or name]", "dial [number]"
  const callMatch = q.match(/^(?:please\s+)?(?:call|dial|phone)\s+(.+)$/i);
  if (callMatch) {
    const target = callMatch[1].trim();
    const cleanNumber = target.replace(/[^0-9+]/g, '');
    const telUrl = `tel:${cleanNumber || target}`;
    return {
      matched: true,
      action: 'phone_call',
      url: telUrl,
      targetName: `Phone Call (${target})`,
      feedbackSpeech: `Calling ${target}.`,
      riskLevel: 'sensitive',
      parameters: { contact: target, telUrl },
    };
  }

  // 2. Email Command: "email [address]", "send email to [address]"
  const emailMatch = q.match(/^(?:please\s+)?(?:send\s+(?:an?\s+)?email\s+(?:to\s+)?|email\s+)(.+)$/i);
  if (emailMatch) {
    const target = emailMatch[1].trim();
    const mailUrl = `mailto:${target}`;
    return {
      matched: true,
      action: 'email',
      url: mailUrl,
      targetName: `Email to ${target}`,
      feedbackSpeech: `Opening mail composer for ${target}.`,
      riskLevel: 'moderate',
      parameters: { recipient: target, mailUrl },
    };
  }

  // 3. SMS / Message Command: "send message to [target]", "text [target]", "sms [target]"
  const smsMatch = q.match(/^(?:please\s+)?(?:send\s+(?:a\s+)?(?:sms|text|message)\s+(?:to\s+)?|sms\s+|text\s+)(.+)$/i);
  if (smsMatch) {
    const target = smsMatch[1].trim();
    const cleanNumber = target.replace(/[^0-9+]/g, '');
    const smsUrl = `sms:${cleanNumber || target}`;
    return {
      matched: true,
      action: 'sms',
      url: smsUrl,
      targetName: `SMS to ${target}`,
      feedbackSpeech: `Drafting SMS to ${target}.`,
      riskLevel: 'moderate',
      parameters: { recipient: target, smsUrl },
    };
  }

  // 4. Camera Command: "open camera", "take photo", "start camera"
  if (/^(?:please\s+)?(?:open|start|launch|access)\s+(?:the\s+)?camera\b/i.test(q) || /take\s+(?:a\s+)?(?:photo|picture|selfie)/i.test(q)) {
    return {
      matched: true,
      action: 'camera',
      targetName: 'Device Camera',
      feedbackSpeech: 'Opening camera viewfinder.',
      riskLevel: 'sensitive',
      parameters: {},
    };
  }

  // 5. Battery Status Command: "check battery", "battery status", "battery percentage", "how much battery"
  if (/\b(?:check\s+battery|battery\s+(?:status|percentage|level)|how\s+much\s+battery)\b/i.test(q)) {
    return {
      matched: true,
      action: 'battery',
      targetName: 'Battery Status',
      feedbackSpeech: 'Checking battery level.',
      riskLevel: 'safe',
      parameters: {},
    };
  }

  // 6. Device Vibrate / Buzz Command: "vibrate phone", "buzz phone", "vibrate"
  if (/^(?:please\s+)?(?:vibrate|buzz)(?:\s+(?:the\s+|my\s+)?(?:phone|device))?$/i.test(q)) {
    return {
      matched: true,
      action: 'vibrate',
      targetName: 'Haptic Feedback',
      feedbackSpeech: 'Vibrating phone.',
      riskLevel: 'safe',
      parameters: {},
    };
  }

  // 7. Timer Command: "set timer for 5 minutes", "timer 10 minutes"
  const timerMatch = q.match(/^(?:please\s+)?(?:set\s+(?:a\s+)?)?timer\s+(?:for\s+)?(\d+)\s*(?:minute|min|seconds?|sec)/i);
  if (timerMatch) {
    const minutes = parseInt(timerMatch[1], 10);
    return {
      matched: true,
      action: 'timer',
      targetName: `Timer (${minutes} min)`,
      feedbackSpeech: `Setting timer for ${minutes} minute${minutes > 1 ? 's' : ''}.`,
      riskLevel: 'safe',
      parameters: { minutes },
    };
  }

  // 8. Search [service] for [query]: "search youtube for jazz"
  const searchPattern = /^(?:search|look\s+up|find)\s+([a-z\s]+)\s+(?:for|about|on)\s+(.+)$/i;
  const searchMatch = q.match(searchPattern);
  if (searchMatch) {
    const serviceKey = searchMatch[1].trim();
    const query = searchMatch[2].trim();
    const target = COMMAND_TARGETS[serviceKey];
    if (target && target.searchUrl) {
      return {
        matched: true,
        action: 'search',
        url: target.searchUrl(query),
        targetName: target.name,
        feedbackSpeech: `Searching ${target.name} for ${query}. Opening now.`,
        riskLevel: 'safe',
        parameters: { query, service: target.name },
      };
    }
  }

  // 9. Open and Search: "open youtube and search [query]"
  const openSearchPattern = /^(?:open|launch|go\s+to|start)\s+([a-z\s]+)\s+(?:and\s+)?search\s+(?:for\s+)?(.+)$/i;
  const openSearchMatch = q.match(openSearchPattern);
  if (openSearchMatch) {
    const serviceKey = openSearchMatch[1].trim();
    const query = openSearchMatch[2].trim();
    const target = COMMAND_TARGETS[serviceKey];
    if (target && target.searchUrl) {
      return {
        matched: true,
        action: 'search',
        url: target.searchUrl(query),
        targetName: target.name,
        feedbackSpeech: `Searching ${target.name} for ${query}. Opening now.`,
        riskLevel: 'safe',
        parameters: { query, service: target.name },
      };
    }
  }

  // 10. Open [app / url]: "open youtube", "open google", "launch maps"
  const openPattern = /^(?:please\s+)?(?:can\s+you\s+)?(?:open|launch|go\s+to|navigate\s+to|visit|start)\s+(?:the\s+)?(?:real\s+)?(.+)$/i;
  const openMatch = q.match(openPattern);
  if (openMatch) {
    let targetPhrase = openMatch[1].trim().replace(/\.$/, '');
    targetPhrase = targetPhrase.replace(/\s+(?:website|site|app|application|page)$/i, '').trim();

    if (COMMAND_TARGETS[targetPhrase]) {
      const target = COMMAND_TARGETS[targetPhrase];
      return {
        matched: true,
        action: 'open_url',
        url: target.url,
        targetName: target.name,
        feedbackSpeech: `Opening ${target.name} for you.`,
        riskLevel: 'safe',
        parameters: { url: target.url },
      };
    }

    if (targetPhrase.includes('.') && !targetPhrase.includes(' ')) {
      const url = targetPhrase.startsWith('http') ? targetPhrase : `https://${targetPhrase}`;
      return {
        matched: true,
        action: 'open_url',
        url,
        targetName: targetPhrase,
        feedbackSpeech: `Opening ${targetPhrase}.`,
        riskLevel: 'moderate',
        parameters: { url },
      };
    }

    for (const [key, target] of Object.entries(COMMAND_TARGETS)) {
      if (targetPhrase === key || targetPhrase.startsWith(key + ' ') || targetPhrase.endsWith(' ' + key)) {
        return {
          matched: true,
          action: 'open_url',
          url: target.url,
          targetName: target.name,
          feedbackSpeech: `Opening ${target.name} for you.`,
          riskLevel: 'safe',
          parameters: { url: target.url },
        };
      }
    }

    if (/^[a-z0-9-]+$/i.test(targetPhrase)) {
      const url = `https://www.${targetPhrase}.com`;
      return {
        matched: true,
        action: 'open_url',
        url,
        targetName: targetPhrase,
        feedbackSpeech: `Opening ${targetPhrase}.`,
        riskLevel: 'moderate',
        parameters: { url },
      };
    }
  }

  return null;
}

/**
 * Safely executes the open url command
 */
export function executeOpenUrl(url: string): { opened: boolean; url: string } {
  if (typeof window === 'undefined') return { opened: false, url };

  try {
    const newWindow = window.open(url, '_blank', 'noopener,noreferrer');
    if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    return { opened: true, url };
  } catch (err) {
    console.error('Failed to open url:', err);
    return { opened: false, url };
  }
}

/**
 * Execute device command (vibrate, battery check, phone dialer)
 */
export async function executeDeviceCommand(cmd: VoiceCommandResult): Promise<{ success: boolean; message: string }> {
  if (typeof window === 'undefined') return { success: false, message: 'Browser environment only' };

  switch (cmd.action) {
    case 'open_url':
    case 'search':
    case 'phone_call':
    case 'email':
    case 'sms':
      if (cmd.url) {
        executeOpenUrl(cmd.url);
        return { success: true, message: `Opened ${cmd.targetName}` };
      }
      return { success: false, message: 'No target URL provided' };

    case 'vibrate':
      if ('vibrate' in navigator) {
        navigator.vibrate([200, 100, 200]);
        return { success: true, message: 'Phone vibrated successfully' };
      }
      return { success: false, message: 'Vibration not supported on this device' };

    case 'battery':
      if ('getBattery' in navigator) {
        try {
          const battery: any = await (navigator as any).getBattery();
          const pct = Math.round(battery.level * 100);
          const chargingStr = battery.charging ? 'charging' : 'on battery';
          return { success: true, message: `Battery is at ${pct}% (${chargingStr})` };
        } catch {
          return { success: false, message: 'Battery API query failed' };
        }
      }
      return { success: false, message: 'Battery API not supported in this browser' };

    case 'timer':
      if (cmd.parameters?.minutes) {
        const ms = cmd.parameters.minutes * 60 * 1000;
        setTimeout(() => {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Manus Timer Completed', {
              body: `Your ${cmd.parameters?.minutes} minute timer is done!`,
            });
          }
          alert(`⏰ Timer Finished: ${cmd.parameters?.minutes} minutes have elapsed.`);
        }, ms);
        return { success: true, message: `Timer set for ${cmd.parameters.minutes} minutes` };
      }
      return { success: false, message: 'Missing timer duration' };

    default:
      return { success: false, message: 'Unknown device command' };
  }
}
