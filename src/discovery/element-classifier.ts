/**
 * Element Classifier
 *
 * Classifies discovered DOM elements into meaningful UI categories.
 * Used by the crawler to tag elements in the inventory.
 */

import type { ElementClassification } from '../config/types.js';

interface RawElement {
  tag: string;
  type?: string;
  role?: string;
  label?: string;
  text?: string;
}

export function classifyElement(el: RawElement): ElementClassification {
  // Role-based classification first (most semantic)
  if (el.role === 'button' || el.tag === 'button') return 'button';
  if (el.role === 'tab') return 'tab';
  if (el.role === 'dialog') return 'dialog';
  if (el.role === 'checkbox') return 'checkbox';
  if (el.role === 'switch') return 'toggle';
  if (el.role === 'menu') return 'menu';
  if (el.role === 'searchbox') return 'search-input';
  if (el.role === 'link' || el.tag === 'a') return 'link';

  // Input type classification
  if (el.tag === 'input') {
    switch (el.type) {
      case 'text': return 'text-input';
      case 'password': return 'password-input';
      case 'email': return 'email-input';
      case 'search': return 'search-input';
      case 'file': return 'file-upload';
      case 'checkbox': return 'checkbox';
      case 'date': case 'datetime-local': return 'date-input';
      default: return 'text-input';
    }
  }

  // Other element types
  if (el.tag === 'textarea') return 'textarea';
  if (el.tag === 'select') return 'select';
  if (el.tag === 'table') return 'table';
  if (el.tag === 'form') return 'form';

  return 'other';
}
