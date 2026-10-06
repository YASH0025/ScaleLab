import type { Problem } from '../types';
import { aiAssistant } from './ai-assistant';
import { chat } from './chat';
import { fileStorage } from './file-storage';
import { flashSale } from './flash-sale';
import { instagram } from './instagram';
import { newsFeed } from './news-feed';
import { notifications } from './notifications';
import { pastebin } from './pastebin';
import { rateLimiter } from './rate-limiter';
import { rideSharing } from './ride-sharing';
import { ticketBooking } from './ticket-booking';
import { typeahead } from './typeahead';
import { urlShortener } from './url-shortener';
import { video } from './video';
import { webCrawler } from './web-crawler';

/** Every concept a problem touches: the ones it lists, plus those its checks and follow-ups use. */
function withConcepts(p: Problem): Problem {
  const used = [...p.checks.flatMap((c) => c.concepts), ...(p.simChecks ?? []).flatMap((c) => c.concepts), ...p.followUps.flatMap((f) => f.concepts)];
  return { ...p, concepts: [...new Set([...p.concepts, ...used])] };
}

/** Easiest first, then by how often they come up in interviews. */
export const PROBLEMS: Problem[] = [
  urlShortener,
  pastebin,
  rateLimiter,
  typeahead,
  notifications,
  webCrawler,
  flashSale,
  aiAssistant,
  instagram,
  newsFeed,
  chat,
  video,
  rideSharing,
  fileStorage,
  ticketBooking,
].map(withConcepts);

export const problemById = new Map(PROBLEMS.map((p) => [p.id, p]));
