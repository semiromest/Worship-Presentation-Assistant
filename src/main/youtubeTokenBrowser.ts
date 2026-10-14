// Built as a separate browser IIFE; executed only in a sandboxed anonymous window.
import { BotGuardClient } from 'bgutils-js/botguard';
import { WebPoMinter } from 'bgutils-js/webpo';

Object.assign(globalThis, { musicBotGuard: { BotGuardClient, WebPoMinter } });
