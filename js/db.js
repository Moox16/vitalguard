// js/db.js
// All Supabase database interactions

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.3/+esm';

// ─── Replace these with your actual Supabase project values ───
const SUPABASE_URL = 'https://ektychwtekgekblxtmnx.supabase.co/';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrdHljaHd0ZWtnZWtibHh0bW54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0MDIzNjIsImV4cCI6MjA5Mjk3ODM2Mn0.ucwNoAQPTndySkM-YKWabzyxrf6gFphOeLUJIJVwmI8';
// ──────────────────────────────────────────────────────────────

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Patients ──────────────────────────────────────────────────

export async function getPatients() {
  const { data, error } = await supabase
    .from('patients')
    .select('*')
    .order('name');
  if (error) throw error;
  return data;
}

export async function addPatient(patient) {
  const { data, error } = await supabase
    .from('patients')
    .insert([patient])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletePatient(id) {
  const { error } = await supabase.from('patients').delete().eq('id', id);
  if (error) throw error;
}

export async function updatePatient(id, fields) {
  const { data, error } = await supabase
    .from('patients')
    .update(fields)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Vitals ────────────────────────────────────────────────────

export async function saveReading(patientId, reading) {
  // reading: { heart_rate, spo2, temperature, fall_detected }
  const { data, error } = await supabase
    .from('vitals')
    .insert([{ patient_id: patientId, ...reading }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getLatestReading(patientId) {
  const { data, error } = await supabase
    .from('vitals')
    .select('*')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Fetch the latest reading for ALL patients in one query
export async function getLatestReadingsAll() {
  const { data, error } = await supabase
    .from('vitals')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;

  // Keep only the first (most recent) reading per patient
  const seen = new Set();
  const latest = {};
  (data || []).forEach(r => {
    if (!seen.has(r.patient_id)) {
      seen.add(r.patient_id);
      latest[r.patient_id] = r;
    }
  });
  return latest; // { patient_id: reading }
}

export async function getReadings(patientId, limit = 50) {
  const { data, error } = await supabase
    .from('vitals')
    .select('*')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function getAllReadings(limit = 100) {
  const { data, error } = await supabase
    .from('vitals')
    .select('*, patients(id, name, notes)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// ── Alerts ────────────────────────────────────────────────────

export async function getAlerts(limit = 20) {
  const { data, error } = await supabase
    .from('alerts')
    .select('*, patients(name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function createAlert(patientId, type, message) {
  const { error } = await supabase
    .from('alerts')
    .insert([{ patient_id: patientId, type, message }]);
  if (error) throw error;
}

export async function clearAlerts() {
  const { error } = await supabase.from('alerts').delete().neq('id', 0);
  if (error) throw error;
}
