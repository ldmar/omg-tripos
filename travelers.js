/* ============================================================
   OhMyGoch Trip OS · travelers.js
   CRUD de viajeros + perfil cifrado (documento, contacto emergencia)
   ============================================================ */

import * as trips  from './trips.js';
import * as vault  from './vault.js';
import * as crypto from './crypto.js';

const COLORS = [
  '#ff5c39', '#f59e0b', '#10b981', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#6366f1',
];

const ROLES = {
  organizer: { label: 'Organizador', icon: '⭐' },
  guest:     { label: 'Invitado',    icon: '👤' },
};

export function getColorPalette() { return [...COLORS]; }
export function getRoles() { return { ...ROLES }; }

export async function createTraveler(tripId, data) {
  if (!tripId) throw new Error('Sin viaje');
  const id = 'tr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const traveler = {
    id,
    tripId,
    name: (data.name || 'Viajero').trim().slice(0, 40),
    role: data.role || 'guest',
    color: data.color || COLORS[0],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await applyProfile(traveler, data);
  await trips.idbPut(trips.STORES.TRAVELERS, traveler);
  return traveler;
}

export async function updateTraveler(traveler, data) {
  const next = {
    ...traveler,
    name:  (data.name || traveler.name).trim().slice(0, 40),
    role:  data.role  || traveler.role,
    color: data.color || traveler.color,
    updatedAt: Date.now(),
  };
  await applyProfile(next, data);
  await trips.idbPut(trips.STORES.TRAVELERS, next);
  return next;
}

async function applyProfile(traveler, data) {
  const profile = {
    document:         data.document         ?? null,
    emergencyContact: data.emergencyContact ?? null,
  };

  // Si no hay nada sensible, no ciframos
  const hasData = profile.document || profile.emergencyContact;
  if (!hasData) {
    delete traveler.encryptedProfile;
    return;
  }

  if (!vault.isUnlocked()) {
    // Sin vault, no podemos cifrar: NO guardamos el perfil
    throw new Error('Desbloqueá el vault para guardar datos sensibles');
  }

  const key = await vault.getTripKey(traveler.tripId, { create: true });
  traveler.encryptedProfile = await crypto.encryptString(
    key, JSON.stringify(profile), `trav:${traveler.id}`
  );
}

export async function getTravelerProfile(traveler) {
  if (!traveler?.encryptedProfile) return { document: null, emergencyContact: null };
  if (!vault.isUnlocked()) return null;
  try {
    const key = await vault.getTripKey(traveler.tripId);
    if (!key) return null;
    const json = await crypto.decryptString(
      key, traveler.encryptedProfile, `trav:${traveler.id}`
    );
    return JSON.parse(json);
  } catch (err) {
    console.warn('[travelers] decrypt profile falló:', err.message);
    return null;
  }
}

export async function deleteTraveler(id) {
  await trips.idbDelete(trips.STORES.TRAVELERS, id);
}

export function initials(name) {
  return (name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase() || '?';
}