/**
 * Safe Animated PulsoIcon Wrapper Library
 *
 * Wraps the specific `pulsoicon-core` icon specs used across the app with our
 * mount-safe `createIcon` factory (`pulsoiconSafeCreateIcon.tsx`).
 *
 * Why:
 * 1. Prevents `Error: controls.start() should only be called after a component has mounted`
 *    when a focused button containing a PulsoIcon unmounts during a state transition
 *    (`removeChild` synchronously fires `focusout` before `useEffect` cleanup).
 * 2. Eliminates Vite pre-bundling of all 4,000+ unused icon definitions in `pulsoicon-react`.
 * 3. Preserves the exact SVG geometry, viewBox, stroke, and hover/focus choreography 100% unchanged.
 */

import { createIcon, iconSpec } from './pulsoiconSafeCreateIcon';

import { ArrowUp as arrowUpSpec } from 'pulsoicon-core/icons/arrow-up';
import { ChevronDown as chevronDownSpec } from 'pulsoicon-core/icons/chevron-down';
import { ChevronRight as chevronRightSpec } from 'pulsoicon-core/icons/chevron-right';
import { ChevronUp as chevronUpSpec } from 'pulsoicon-core/icons/chevron-up';
import { Copy as copySpec } from 'pulsoicon-core/icons/copy';
import { Ellipsis as ellipsisSpec } from 'pulsoicon-core/icons/ellipsis';
import { EllipsisVertical as ellipsisVerticalSpec } from 'pulsoicon-core/icons/ellipsis-vertical';
import { MessageSquare as messageSquareSpec } from 'pulsoicon-core/icons/message-square';
import { MessageSquarePlus as messageSquarePlusSpec } from 'pulsoicon-core/icons/message-square-plus';
import { Mic as micSpec } from 'pulsoicon-core/icons/mic';
import { PanelLeft as panelLeftSpec } from 'pulsoicon-core/icons/panel-left';
import { Paperclip as paperclipSpec } from 'pulsoicon-core/icons/paperclip';
import { PenLine as penLineSpec } from 'pulsoicon-core/icons/pen-line';
import { Plus as plusSpec } from 'pulsoicon-core/icons/plus';
import { RotateCcwClock as rotateCcwClockSpec } from 'pulsoicon-core/icons/rotate-ccw-clock';
import { Search as searchSpec } from 'pulsoicon-core/icons/search';
import { Settings as settingsSpec } from 'pulsoicon-core/icons/settings';
import { Share2 as share2Spec } from 'pulsoicon-core/icons/share-2';
import { SquarePen as squarePenSpec } from 'pulsoicon-core/icons/square-pen';
import { ThumbsDown as thumbsDownSpec } from 'pulsoicon-core/icons/thumbs-down';
import { ThumbsUp as thumbsUpSpec } from 'pulsoicon-core/icons/thumbs-up';
import { Trash as trashSpec } from 'pulsoicon-core/icons/trash';

export { createIcon, iconSpec };

export const ArrowUp = createIcon('ArrowUp', 'arrow-up', arrowUpSpec);
export const ChevronDown = createIcon('ChevronDown', 'chevron-down', chevronDownSpec);
export const ChevronRight = createIcon('ChevronRight', 'chevron-right', chevronRightSpec);
export const ChevronUp = createIcon('ChevronUp', 'chevron-up', chevronUpSpec);
export const Copy = createIcon('Copy', 'copy', copySpec);
export const PenLine = createIcon('PenLine', 'pen-line', penLineSpec);
export const Edit3 = PenLine;
export const RotateCcwClock = createIcon('RotateCcwClock', 'rotate-ccw-clock', rotateCcwClockSpec);
export const History = RotateCcwClock;
export const HistoryIcon = RotateCcwClock;
export const MessageSquare = createIcon('MessageSquare', 'message-square', messageSquareSpec);
export const MessageSquarePlus = createIcon(
  'MessageSquarePlus',
  'message-square-plus',
  messageSquarePlusSpec
);
export const Mic = createIcon('Mic', 'mic', micSpec);
export const Ellipsis = createIcon('Ellipsis', 'ellipsis', ellipsisSpec);
export const MoreHorizontal = Ellipsis;
export const EllipsisVertical = createIcon(
  'EllipsisVertical',
  'ellipsis-vertical',
  ellipsisVerticalSpec
);
export const MoreVertical = EllipsisVertical;
export const PanelLeft = createIcon('PanelLeft', 'panel-left', panelLeftSpec);
export const Paperclip = createIcon('Paperclip', 'paperclip', paperclipSpec);
export const Plus = createIcon('Plus', 'plus', plusSpec);
export const Search = createIcon('Search', 'search', searchSpec);
export const Settings = createIcon('Settings', 'settings', settingsSpec);
export const Settings2 = Settings;
export const Share2 = createIcon('Share2', 'share-2', share2Spec);
export const SquarePen = createIcon('SquarePen', 'square-pen', squarePenSpec);
export const ThumbsDown = createIcon('ThumbsDown', 'thumbs-down', thumbsDownSpec);
export const ThumbsUp = createIcon('ThumbsUp', 'thumbs-up', thumbsUpSpec);
export const Trash = createIcon('Trash', 'trash', trashSpec);
export const Trash2 = Trash;
