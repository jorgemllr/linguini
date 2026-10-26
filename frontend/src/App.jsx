import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import dataLocal from './data.json';
import rawTranscript from './transcript.txt?raw';

const getApiUrl = (path) => {
  return path;
};

const cleanTitle = (t) => {
  if (!t) return "";
  return t
    .replace(/^Subrayados:\s*/i, "")
    .replace(/\.[^.]+$/, "") // Remove extensions like .pdf or .mp3
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") // Remove all non-alphanumeric characters completely
    .trim();
};

const isAudioMatchingDoc = (audio, doc) => {
  if (!audio || !doc) return false;
  if (audio.title === doc.title) return true;
  if (audio.url && doc.audio_url && audio.url === doc.audio_url) return true;
  
  const cleanAudioTitle = cleanTitle(audio.title || "");
  const cleanDocTitle = cleanTitle(doc.title || "");
  
  if (!cleanAudioTitle || !cleanDocTitle) return false;
  
  return cleanAudioTitle.includes(cleanDocTitle) || cleanDocTitle.includes(cleanAudioTitle);
};

// Finds if a document has an associated audio file
const findAudioForDoc = (doc, allDocs = []) => {
  if (!doc) return null;
  if (doc.audio_url) {
    return { url: doc.audio_url, title: doc.title };
  }
  const audioDocs = allDocs.filter(d => d.language === 'audio');
  const matched = audioDocs.find(a => isAudioMatchingDoc(a, doc));
  if (matched) {
    return { url: matched.audio_url, title: matched.title };
  }
  return null;
};

// Extracts series title, chapter label, and track number for multi-track audiobooks
const parseAudioSeries = (title) => {
  if (!title) return { series: "Audiobook", trackLabel: "Track 1", trackNum: 1, isMulti: false, originalTitle: "" };
  const clean = title.replace(/^Subrayados:\s*/i, "").replace(/\.[^.]+$/, "").trim();
  
  // Matches: "Series - 01", "Series - Track 01", "Series Chapter 02", "Series_03", "Series (Part 1)"
  const regex = /^(.*?)(?:[\s\-_]+(?:track|chapter|capitulo|capítulo|part|cd|disc|piste|ch)?[\s\-_]*(\d+))$/i;
  const match = clean.match(regex);
  if (match && match[1] && match[1].trim()) {
    const series = match[1].replace(/[\s\-_]+$/, "").trim();
    const trackNum = parseInt(match[2], 10);
    return {
      series,
      trackLabel: `Track ${match[2]}`,
      trackNum: isNaN(trackNum) ? 1 : trackNum,
      isMulti: true,
      originalTitle: clean
    };
  }
  return {
    series: clean,
    trackLabel: clean,
    trackNum: 1,
    isMulti: false,
    originalTitle: clean
  };
};

// Groups a list of audio documents by their series title
const groupAudiobooks = (audioList) => {
  const map = new Map();
  audioList.forEach(doc => {
    const info = parseAudioSeries(doc.title);
    if (!map.has(info.series)) {
      map.set(info.series, {
        series: info.series,
        tracks: []
      });
    }
    map.get(info.series).tracks.push({
      ...doc,
      trackNum: info.trackNum,
      trackLabel: info.trackLabel
    });
  });

  const result = [];
  map.forEach(group => {
    group.tracks.sort((a, b) => a.trackNum - b.trackNum);
    result.push(group);
  });
  return result;
};

// Sanitizes a filename to ensure a 100% valid ASCII key for Supabase Storage (removes accents/diacritics and special characters to prevent 400 InvalidKey)
const sanitizeStorageKey = (filename) => {
  if (!filename) return 'file';
  const dotIndex = filename.lastIndexOf('.');
  const ext = dotIndex !== -1 ? filename.slice(dotIndex) : '';
  const base = dotIndex !== -1 ? filename.slice(0, dotIndex) : filename;
  
  const cleanBase = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_');

  const cleanExt = ext
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9.]/g, '')
    .toLowerCase();

  return `${cleanBase || 'file'}${cleanExt}`;
};

// Supabase Storage: direct browser upload (bypasses Vercel 4.5MB limit)
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const uploadToSupabaseStorage = async (file, storagePath, onProgress) => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/media/${storagePath}`);
    xhr.setRequestHeader('Authorization', `Bearer ${SUPABASE_ANON_KEY}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(`${SUPABASE_URL}/storage/v1/object/public/media/${storagePath}`);
      } else {
        reject(new Error(`Storage upload failed: ${xhr.status} ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(file);
  });
};

// Supabase Direct REST helper for automatic fallback when local Python backend is not running
const fetchFromSupabase = async (endpoint, options = {}) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  return fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    ...options,
    headers
  });
};

// Direct client-side Gemini fallback for word analysis if backend server is unreachable
const analyzeWordViaGemini = async (word, context, langCode, mode) => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("No Gemini API key available");
  const langNames = { de: 'German', en: 'English', fr: 'French', es: 'Spanish', it: 'Italian', pt: 'Portuguese' };
  const langName = langNames[(langCode || 'auto').toLowerCase()] || 'German';
  const prompt = mode === 'simple'
    ? `Act as an expert ${langName} teacher. The user does not understand "${word}".
Context: "...${context || ''}..."
Translate "${word}" IN THIS CONTEXT and return a valid JSON object with exactly:
"es": Direct and concise Spanish translation adapted to this context.
"en": Direct and concise English translation adapted to this context.
"grammar": ""
"alternatives": []
"examples": []`
    : `Act as an expert ${langName} teacher. The user does not understand "${word}".
Context: "...${context || ''}..."
Analyze "${word}" IN THIS CONTEXT and return a valid JSON object with exactly:
"es": Main Spanish translation adapted to this context.
"en": Main English translation adapted to this context.
"grammar": Brief grammatical explanation (part of speech, tense, verb root).
"alternatives": Array of strings with other key translations or meanings in other contexts (max 2-3).
"examples": Array of 2 example objects with keys "original" and "es_translation".`;

  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { response_mime_type: "application/json" }
    })
  });
  if (!resp.ok) throw new Error(`Gemini API error ${resp.status}`);
  const data = await resp.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error("Empty response from Gemini");
  return JSON.parse(rawText);
};

// --- DATABASE OFFLINE STORAGE (INDEXEDDB) ---
const IDB_NAME = 'LinguiniOfflineCache';
const STORE_NAME = 'audiobooks';

const getIDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
};

const getCachedAudio = async (url) => {
  try {
    const db = await getIDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(url);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("IndexedDB get error:", err);
    return null;
  }
};

const saveCachedAudio = async (url, blob) => {
  try {
    const db = await getIDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(blob, url);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("IndexedDB save error:", err);
    return false;
  }
};

const deleteCachedAudio = async (url) => {
  try {
    const db = await getIDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(url);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("IndexedDB delete error:", err);
    return false;
  }
};

// --- ICONOS SVG ---
const DownloadIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.7 }}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
    <polyline points="7 10 12 15 17 10"></polyline>
    <line x1="12" y1="15" x2="12" y2="3"></line>
  </svg>
);
const DeleteTrashIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.7 }}>
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    <line x1="10" y1="11" x2="10" y2="17"></line>
    <line x1="14" y1="11" x2="14" y2="17"></line>
  </svg>
);
const CheckIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: '#30D158' }}>
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
);
const SpinnerIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ flexShrink: 0, color: '#0A84FF', animation: 'spin 1s linear infinite' }}>
    <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.1)"></circle>
    <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor"></path>
  </svg>
);
const MenuIcon = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>;
const PlusIcon = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>;
const PlayIcon = () => <svg width="42" height="42" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>;
const PauseIcon = () => <svg width="42" height="42" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>;
const BackIcon = () => <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>;
const ForwardIcon = () => <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>;
const PrevTrackIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="19 20 9 12 19 4 19 20"></polygon>
    <rect x="5" y="4" width="2.5" height="16" rx="1"></rect>
  </svg>
);
const NextTrackIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 4 15 12 5 20 5 4"></polygon>
    <rect x="16.5" y="4" width="2.5" height="16" rx="1"></rect>
  </svg>
);
const CloseIconSimple = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>;
const CloseIconCircle = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="none">
    <circle cx="12" cy="12" r="10" fill="rgba(60, 60, 67, 0.6)" />
    <path d="M15 9L9 15" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M9 9L15 15" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
// Nuevo Icono de Bocina (Speaker)
const SpeakerIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
  </svg>
);

// Nuevos Iconos del Sidebar
const ChevronIcon = ({ isOpen }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', opacity: 0.6 }}><polyline points="9 18 15 12 9 6"></polyline></svg>
);
const BookIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
);
const CloudIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
);
const AudioIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
);
const VocabIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M12 2H2v20h20V12"></path><path d="M17 2v6h6"></path><path d="M7 11h6"></path><path d="M7 15h10"></path></svg>
);
const SearchSmallIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.6 }}><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
);
const FolderIcon = ({ isOpen }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: '#FFD60A' }}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
  </svg>
);
const FolderIconSmall = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
);
const EditIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
);
const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
);

function App() {
  // Theme system constant (defined at the top forTemporal Dead Zone avoidance)
  const theme = {
    bg: '#111111',
    text: '#E5E5E7',
    textSecondary: '#86868b',
    headerBg: 'rgba(17, 17, 17, 0.8)', 
    modalBg: 'rgba(28, 28, 30, 0.65)', 
    accent: '#0A84FF',
    border: 'rgba(255,255,255,0.08)',
    highlightBg: 'rgba(255, 179, 64, 0.2)',
    highlightText: '#FFD60A',
    highlightBorder: 'rgba(255, 214, 10, 0.3)',
  };

  // Helper to read synchronously from localStorage for instant, flash-free startup
  const getInitialDoc = () => {
    const saved = localStorage.getItem('last-opened-doc');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed) return parsed;
      } catch (e) {}
    }
    return {
      id: 'demo',
      title: 'Demo: Podcast Alemán',
      content: rawTranscript,
      audio_url: '/podcast.mp3',
      language: 'de',
      created_at: new Date().toISOString()
    };
  };

  const getInitialDocs = () => {
    const saved = localStorage.getItem('last-opened-doc');
    const demoDoc = {
      id: 'demo',
      title: 'Demo: Podcast Alemán',
      content: rawTranscript,
      audio_url: '/podcast.mp3',
      language: 'de',
      created_at: new Date().toISOString()
    };
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.id !== 'demo') {
          return [parsed, demoDoc];
        }
      } catch (e) {}
    }
    return [demoDoc];
  };

  const getInitialAudio = (initDoc) => {
    const lastAudio = localStorage.getItem('last-active-audio');
    if (lastAudio) {
      try {
        const parsed = JSON.parse(lastAudio);
        if (parsed && parsed.url && parsed.title) {
          return parsed;
        }
      } catch (e) {}
    }
    if (initDoc && initDoc.audio_url) {
      return {
        url: initDoc.audio_url.startsWith('http') || initDoc.audio_url.startsWith('/') 
          ? initDoc.audio_url 
          : getApiUrl(initDoc.audio_url),
        title: initDoc.title
      };
    }
    return null;
  };

  const getInitialAudioTime = (initAudio) => {
    if (initAudio && initAudio.title) {
      const savedTime = localStorage.getItem(`audio-progress-${cleanTitle(initAudio.title)}`);
      if (savedTime) {
        const parsedTime = parseFloat(savedTime);
        if (!isNaN(parsedTime)) return parsedTime;
      }
    }
    return 0;
  };

  const initialDocVal = getInitialDoc();
  const initialAudioVal = getInitialAudio(initialDocVal);

  // --- ESTADOS ---
  const [documents, setDocuments] = useState(getInitialDocs);
  const documentsRef = useRef(documents);
  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);
  const [currentDoc, setCurrentDoc] = useState(initialDocVal);
  const [activeAudio, setActiveAudio] = useState(initialAudioVal);
  const currentDocRef = useRef(currentDoc);
  const activeAudioRef = useRef(activeAudio);

  useEffect(() => {
    currentDocRef.current = currentDoc;
  }, [currentDoc]);

  useEffect(() => {
    activeAudioRef.current = activeAudio;
  }, [activeAudio]);

  const getActiveAudioTimeForDoc = () => {
    const activeAudioVal = activeAudioRef.current;
    const currentDocVal = currentDocRef.current;
    if (activeAudioVal && currentDocVal && isAudioMatchingDoc(activeAudioVal, currentDocVal) && audioRef.current) {
      return audioRef.current.currentTime;
    }
    return currentDocVal?.scroll_position || 0.0;
  };

  const [currentPage, setCurrentPage] = useState(1);
  const currentPageRef = useRef(1);
  const pageHeightsRef = useRef({});
  const isRestoringScrollRef = useRef(true);
  const isInitialDocsLoadedRef = useRef(false);
  const hasRestoredAudioRef = useRef(false);

  const restorePageScroll = useCallback((targetPage, targetScroll, docToUse = currentDoc) => {
    isRestoringScrollRef.current = true;
    setCurrentPage(targetPage);
    currentPageRef.current = targetPage;
    
    let targetContainerIdx = targetPage - 1; // Default sequential fallback
    if (docToUse) {
      const parts = docToUse.content.split('\n---\n');
      const textContent = parts[0] || '';
      const pageMatches = [...textContent.matchAll(/<!-- PAGE (\d+) -->/g)].map(m => parseInt(m[1], 10));
      if (pageMatches.length > 0) {
        const matchIdx = pageMatches.indexOf(targetPage);
        if (matchIdx !== -1) {
          targetContainerIdx = matchIdx + 1; // pageMatches[matchIdx] corresponds to pIdx = matchIdx + 1
        } else if (targetPage < pageMatches[0]) {
          targetContainerIdx = 0;
        }
      }
    }
    
    if (targetContainerIdx > 0) {
      let attempts = 0;
      const scrollTimer = setInterval(() => {
        const targetEl = document.querySelector(`[data-page-idx="${targetContainerIdx}"]`);
        attempts++;
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'instant', block: 'start' });
          clearInterval(scrollTimer);
          setTimeout(() => {
            isRestoringScrollRef.current = false;
            console.log("Restored reading progress to page index:", targetContainerIdx, "visual page:", targetPage);
          }, 150);
        } else if (attempts > 80) { // 4 seconds max polling
          clearInterval(scrollTimer);
          isRestoringScrollRef.current = false;
        }
      }, 50);
    } else {
      window.scrollTo(0, 0);
      setTimeout(() => {
        isRestoringScrollRef.current = false;
      }, 150);
    }
  }, [currentDoc]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  
  const [isManualOffline, setIsManualOffline] = useState(() => localStorage.getItem('manual-offline') === 'true');
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    localStorage.setItem('manual-offline', isManualOffline.toString());
  }, [isManualOffline]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const isAppOffline = !isOnline || isManualOffline;
  
  const [selectedWord, setSelectedWord] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [offlineDict, setOfflineDict] = useState(null);
  const [showBookmarkModal, setShowBookmarkModal] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [manualLang, setManualLang] = useState("fr");
  const [manualAudioFile, setManualAudioFile] = useState(null);

  const [importTab, setImportTab] = useState("manual");
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfTitle, setPdfTitle] = useState("");
  const [pdfLang, setPdfLang] = useState("fr");
  const [pdfAudioUrl, setPdfAudioUrl] = useState("");
  const [importingPdf, setImportingPdf] = useState(false);

  // --- GESTIÓN DE CARPETAS / COLECCIONES ---
  const [folders, setFolders] = useState(() => {
    try {
      const saved = localStorage.getItem('app-folders');
      return saved ? JSON.parse(saved) : [];
    } catch(e) { return []; }
  });
  const [docFolders, setDocFolders] = useState(() => {
    try {
      const saved = localStorage.getItem('app-doc-folders');
      return saved ? JSON.parse(saved) : {};
    } catch(e) { return {}; }
  });
  const [selectedFolder, setSelectedFolder] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [openFolders, setOpenFolders] = useState({});
  const [moveModalDoc, setMoveModalDoc] = useState(null);

  // --- MODAL DE EDICIÓN NATIVO DE DOCUMENTO ---
  const [editModalDoc, setEditModalDoc] = useState(null);
  const [editDocTitle, setEditDocTitle] = useState("");
  const [editDocContent, setEditDocContent] = useState("");
  const [editDocLang, setEditDocLang] = useState("fr");
  const [editDocAudioFile, setEditDocAudioFile] = useState(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editAudioProgress, setEditAudioProgress] = useState(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => getInitialAudioTime(initialAudioVal));
  const [duration, setDuration] = useState(0);
  const audioRef = useRef(null);
  const isInitRef = useRef(false);
  const isDraggingRef = useRef(false);
  const longPressTimer = useRef(null);
  const isLongPress = useRef(false);
  const touchStartY = useRef(null); // Track initial touch Y to detect scroll vs select
  const touchScrollAborted = useRef(false); // True when touch was identified as a scroll

  // --- DRAG SELECTION AND TRACKPAD-SAFE LONG-PRESS REFS ---
  const [tempDraggedWords, setTempDraggedWords] = useState([]);
  const dragStartCoords = useRef(null);
  const isSelectingRange = useRef(false);
  const isDraggingSelection = useRef(false);
  const dragParagraphKey = useRef(null);
  const dragParagraphText = useRef(null);
  const dragStartFlatIdx = useRef(null);
  const draggedWordsRef = useRef([]);
  const activeSingleWord = useRef(null);
  const lastProcessedIdx = useRef(null);
  const isPopupClosedByUser = useRef(false);
  const modalOpenedTime = useRef(0);

  // --- CLOUD UPLOAD STATE ---
  const [audioFiles, setAudioFiles] = useState([]);
  const [audioTitle, setAudioTitle] = useState('');
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatusMsg, setUploadStatusMsg] = useState('');
  const [importingPdfCloud, setImportingPdfCloud] = useState(false);
  const [pdfUploadProgress, setPdfUploadProgress] = useState(0);

  // --- ESTADOS PARA PREVISUALIZACIÓN DE TIEMPO (SEEK HOVER) ---
  const [hoverTime, setHoverTime] = useState(null);
  const [hoverX, setHoverX] = useState(0);

  // --- VELOCIDAD DE REPRODUCCIÓN (PLAYBACK RATE) ---
  const [playbackRate, setPlaybackRate] = useState(1.0);

  // --- ESTADO DE ARRASTRE DE LINEA DE TIEMPO (SMOOTH SCRUBBING) ---
  const [isDragging, setIsDragging] = useState(false);

  // Sincronizar estado de arrastre con su Ref para evitar desmontar oyentes de audio
  useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);

  // --- VOCABULARY MODE TOGGLE ---
  const [isDetailedMode, setIsDetailedMode] = useState(() => localStorage.getItem('vocab-detailed-mode') !== 'false');
  useEffect(() => {
    localStorage.setItem('vocab-detailed-mode', isDetailedMode.toString());
  }, [isDetailedMode]);

  // --- VOCABULARY LIST MODAL & MANAGEMENT ---
  const [showVocabModal, setShowVocabModal] = useState(false);
  const [vocabLanguageFilter, setVocabLanguageFilter] = useState('all');
  const [vocabSearchQuery, setVocabSearchQuery] = useState('');
  const [cachedVocabList, setCachedVocabList] = useState([]);
  const [isLoadingVocab, setIsLoadingVocab] = useState(false);

  // --- OFFLINE CACHE STATE ---
  const [cachedUrls, setCachedUrls] = useState({});
  const [downloadProgress, setDownloadProgress] = useState({});
  const [audioSrc, setAudioSrc] = useState('');

  // --- REGISTRO DE INTERACCIONES DEL USUARIO (PREVIENE SOBREESCRITURAS ENTRE DISPOSITIVOS) ---
  const isUserInteractedRef = useRef(false);
  const lastUserInteractionTimeRef = useRef(0);
  const abortControllerRef = useRef(null);

  useEffect(() => {
    const registerInteraction = () => {
      isUserInteractedRef.current = true;
      lastUserInteractionTimeRef.current = Date.now();
    };
    window.addEventListener('click', registerInteraction, { passive: true });
    window.addEventListener('touchstart', registerInteraction, { passive: true });
    window.addEventListener('scroll', registerInteraction, { passive: true });
    window.addEventListener('keydown', registerInteraction, { passive: true });
    return () => {
      window.removeEventListener('click', registerInteraction);
      window.removeEventListener('touchstart', registerInteraction);
      window.removeEventListener('scroll', registerInteraction);
      window.removeEventListener('keydown', registerInteraction);
    };
  }, []);


  // Resolve active audio track source from IndexedDB cache if available
  useEffect(() => {
    let active = true;
    let localUrl = null;
    
    const resolveAudioSrc = async () => {
      if (!activeAudio) {
        setAudioSrc('');
        return;
      }
      
      const cachedBlob = await getCachedAudio(activeAudio.url);
      if (cachedBlob && active) {
        localUrl = URL.createObjectURL(cachedBlob);
        setAudioSrc(localUrl);
        console.log("Playing audiobook from offline IndexedDB cache:", activeAudio.url);
      } else if (active) {
        setAudioSrc(activeAudio.url);
        console.log("Playing audiobook online:", activeAudio.url);
      }
    };
    
    resolveAudioSrc();
    
    return () => {
      active = false;
      if (localUrl) {
        URL.revokeObjectURL(localUrl);
      }
    };
  }, [activeAudio]);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    pageHeightsRef.current = {};
  }, [currentDoc?.id]);

  const syncReadingProgress = async (docId, pageNum, scrollY, force = false) => {
    if (!docId || docId === 'demo') return;
    if (!force) return; // Disable automatic background writes
    try {
      const res = await fetch(getApiUrl(`/api/documents/${docId}/progress`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_page: pageNum, scroll_position: scrollY })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        await fetchFromSupabase(`documents?id=eq.${docId}`, {
          method: 'PATCH',
          body: JSON.stringify({ current_page: pageNum, scroll_position: scrollY })
        }).catch(e => console.warn("Supabase progress fallback error:", e));
      } else {
        console.warn("⚠️ Error syncing reading progress:", err);
      }
    }
  };

  const syncGlobalSettings = async (docId, activeAudioObj, force = false) => {
    if (!docId || docId === 'demo' || docId === 'global_settings') return;
    if (!force) return; // Disable automatic background writes
    try {
      const globalDoc = documents.find(d => d.id === 'global_settings');
      let currentPayload = {};
      if (globalDoc && globalDoc.content) {
        try { currentPayload = JSON.parse(globalDoc.content); } catch (e) {}
      }
      const stateContent = JSON.stringify({
        ...currentPayload,
        active_doc_id: docId,
        active_audio: activeAudioObj
      });
      const res = await fetch(getApiUrl(`/api/documents/global_settings`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: stateContent })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        const globalDoc = documents.find(d => d.id === 'global_settings');
        let currentPayload = {};
        if (globalDoc && globalDoc.content) {
          try { currentPayload = JSON.parse(globalDoc.content); } catch (e) {}
        }
        const stateContent = JSON.stringify({
          ...currentPayload,
          active_doc_id: docId,
          active_audio: activeAudioObj
        });
        await fetchFromSupabase(`documents?id=eq.global_settings`, {
          method: 'PATCH',
          body: JSON.stringify({ content: stateContent })
        }).catch(e => console.warn("Supabase settings fallback error:", e));
      } else {
        console.warn("⚠️ Error syncing global settings:", err);
      }
    }
  };

  const syncFolders = async (newFolders, newDocFolders) => {
    setFolders(newFolders);
    setDocFolders(newDocFolders);
    localStorage.setItem('app-folders', JSON.stringify(newFolders));
    localStorage.setItem('app-doc-folders', JSON.stringify(newDocFolders));
    try {
      const globalDoc = documents.find(d => d.id === 'global_settings');
      let currentPayload = {};
      if (globalDoc && globalDoc.content) {
        try { currentPayload = JSON.parse(globalDoc.content); } catch (e) {}
      }
      const updatedPayload = {
        ...currentPayload,
        folders: newFolders,
        doc_folders: newDocFolders
      };
      const res = await fetch(getApiUrl('/api/documents/global_settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: JSON.stringify(updatedPayload) })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        const globalDoc = documents.find(d => d.id === 'global_settings');
        let currentPayload = {};
        if (globalDoc && globalDoc.content) {
          try { currentPayload = JSON.parse(globalDoc.content); } catch (e) {}
        }
        const updatedPayload = {
          ...currentPayload,
          folders: newFolders,
          doc_folders: newDocFolders
        };
        await fetchFromSupabase(`documents?id=eq.global_settings`, {
          method: 'PATCH',
          body: JSON.stringify({ content: JSON.stringify(updatedPayload) })
        }).catch(e => console.warn("Supabase folders fallback error:", e));
      } else {
        console.warn("⚠️ Error syncing folders to Supabase:", err);
      }
    }
  };

  const createFolder = (name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    if (folders.includes(trimmed)) {
      alert("A folder with that name already exists.");
      return;
    }
    const updated = [...folders, trimmed];
    syncFolders(updated, docFolders);
  };

  const deleteFolder = (folderName) => {
    if (!confirm(`Delete folder "${folderName}"? Documents and audio files will not be deleted; they will be moved to "No folder".`)) return;
    const updatedFolders = folders.filter(f => f !== folderName);
    const updatedDocFolders = { ...docFolders };
    Object.keys(updatedDocFolders).forEach(id => {
      if (updatedDocFolders[id] === folderName) {
        delete updatedDocFolders[id];
      }
    });
    syncFolders(updatedFolders, updatedDocFolders);
  };

  const renameFolder = (oldName) => {
    const newName = prompt(`New name for folder "${oldName}":`, oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) return;
    const trimmed = newName.trim();
    if (folders.includes(trimmed)) {
      alert("A folder with that name already exists.");
      return;
    }
    const updatedFolders = folders.map(f => f === oldName ? trimmed : f);
    const updatedDocFolders = { ...docFolders };
    Object.keys(updatedDocFolders).forEach(id => {
      if (updatedDocFolders[id] === oldName) {
        updatedDocFolders[id] = trimmed;
      }
    });
    syncFolders(updatedFolders, updatedDocFolders);
  };

  const moveDocToFolder = (docId, targetFolder) => {
    const updatedDocFolders = { ...docFolders };
    if (!targetFolder) {
      delete updatedDocFolders[docId];
    } else {
      updatedDocFolders[docId] = targetFolder;
    }
    syncFolders(folders, updatedDocFolders);
  };

  const handleRenameDocument = async (doc, newTitle) => {
    if (!newTitle || !newTitle.trim() || newTitle.trim() === doc.title) return;
    const cleanNewTitle = newTitle.trim();
    setDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, title: cleanNewTitle } : d));
    if (currentDoc?.id === doc.id) {
      setCurrentDoc(prev => ({ ...prev, title: cleanNewTitle }));
    }
    if (activeAudio?.url === doc.audio_url) {
      setActiveAudio(prev => ({ ...prev, title: cleanNewTitle }));
    }
    try {
      const res = await fetch(getApiUrl(`/api/documents/${doc.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: cleanNewTitle })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        await fetchFromSupabase(`documents?id=eq.${doc.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ title: cleanNewTitle })
        }).catch(e => console.warn("Supabase rename fallback error:", e));
      } else {
        console.warn("Error renaming document:", err);
      }
    }
  };

  const handleDeleteDocument = async (doc) => {
    if (!confirm(`Are you sure you want to permanently delete "${doc.title}"?`)) return;
    setDocuments(prev => prev.filter(d => d.id !== doc.id));
    if (docFolders[doc.id]) {
      const nextDocFolders = { ...docFolders };
      delete nextDocFolders[doc.id];
      syncFolders(folders, nextDocFolders);
    }
    if (currentDoc?.id === doc.id) {
      const remaining = documents.filter(d => d.id !== doc.id && d.language !== 'system');
      if (remaining.length > 0) {
        setCurrentDoc(remaining[0]);
      }
    }
    if (activeAudio?.url === doc.audio_url) {
      setActiveAudio(null);
    }
    try {
      const res = await fetch(getApiUrl(`/api/documents/${doc.id}`), {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        await fetchFromSupabase(`documents?id=eq.${doc.id}`, {
          method: 'DELETE'
        }).catch(e => console.warn("Supabase delete fallback error:", e));
      } else {
        console.warn("Error deleting document:", err);
      }
    }
  };

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage("");
    }, 4000);
  };

  const handleSaveBookmark = async () => {
    if (!currentDoc) return;
    const pageVal = currentPage;
    const audioTimeVal = getActiveAudioTimeForDoc();
    
    // Save active text document progress to SQLite/Supabase (force = true)
    await syncReadingProgress(currentDoc.id, pageVal, audioTimeVal, true);
    await syncGlobalSettings(currentDoc.id, activeAudio, true);
    
    // Symmetrically locate and update the associated audio document progress in the database
    let associatedAudioDoc = null;
    if (activeAudio) {
      associatedAudioDoc = documents.find(d => d.id !== currentDoc.id && isAudioMatchingDoc(activeAudio, d));
      if (associatedAudioDoc) {
        await syncReadingProgress(associatedAudioDoc.id, associatedAudioDoc.current_page || 1, audioTimeVal, true);
      }
    }
    
    // Save to localStorage for robust recovery
    localStorage.setItem(`current-page-${currentDoc.id}`, pageVal.toString());
    localStorage.setItem(`scroll-position-${currentDoc.id}`, audioTimeVal.toString());
    if (activeAudio && isAudioMatchingDoc(activeAudio, currentDoc)) {
      localStorage.setItem(`audio-progress-${cleanTitle(activeAudio.title)}`, audioTimeVal.toString());
    }

    // Immediately update local React state for both documents so UI remains fully in sync
    const updatedDoc = {
      ...currentDoc,
      current_page: pageVal,
      scroll_position: audioTimeVal
    };
    setCurrentDoc(updatedDoc);
    localStorage.setItem('last-opened-doc', JSON.stringify(updatedDoc));
    
    setDocuments(prev => prev.map(d => {
      if (d.id === currentDoc.id) {
        return updatedDoc;
      }
      if (associatedAudioDoc && d.id === associatedAudioDoc.id) {
        return { ...d, scroll_position: audioTimeVal };
      }
      return d;
    }));

    // Show toast
    const mins = Math.floor(audioTimeVal / 60);
    const secs = Math.floor(audioTimeVal % 60);
    const audioInfo = activeAudio && isAudioMatchingDoc(activeAudio, currentDoc)
      ? ` | Audio: ${mins}:${secs < 10 ? '0' : ''}${secs}`
      : "";
    showToast(`🔖 Bookmark Saved: Page ${pageVal}${audioInfo}`);
    setShowBookmarkModal(false);
  };

  const processPendingQueue = useCallback(async () => {
    if (!navigator.onLine) return;
    
    // 1. Process pending document updates
    const pendingDocs = localStorage.getItem('pending-document-updates');
    if (pendingDocs) {
      try {
        const docsMap = JSON.parse(pendingDocs);
        const keys = Object.keys(docsMap);
        for (const docId of keys) {
          const content = docsMap[docId];
          try {
            const res = await fetch(getApiUrl(`/api/documents/${docId}`), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content })
            });
            if (res.ok) {
              delete docsMap[docId];
            }
          } catch (e) {
            console.warn("Error re-attempting document sync:", docId, e);
          }
        }
        if (Object.keys(docsMap).length === 0) {
          localStorage.removeItem('pending-document-updates');
        } else {
          localStorage.setItem('pending-document-updates', JSON.stringify(docsMap));
        }
      } catch (e) {
        console.error("Error analyzing pending document updates:", e);
      }
    }

    // 2. Process pending offline translations
    const pendingTrans = localStorage.getItem('pending-offline-translations');
    if (pendingTrans) {
      try {
        let list = JSON.parse(pendingTrans);
        if (!Array.isArray(list)) list = [];
        const remaining = [];
        
        for (const item of list) {
          try {
            const { word, context, language, mode } = item;
            const API_URL = getApiUrl('/api/analyze');
            const res = await fetch(API_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ word, context, language, mode })
            });
            if (!res.ok) throw new Error("API call failed");
            const apiData = await res.json();
            if (apiData.error) throw new Error(apiData.error);
            
            // Save to SQLite/word cache
            await fetch(getApiUrl('/api/word_cache'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                word: word,
                language: language,
                translation_data: apiData
              })
            });
            console.log("Processed offline word successfully:", word);
          } catch (e) {
            console.warn("Error re-attempting offline translation for:", item.word, e);
            remaining.push(item);
          }
        }
        
        if (remaining.length === 0) {
          localStorage.removeItem('pending-offline-translations');
        } else {
          localStorage.setItem('pending-offline-translations', JSON.stringify(remaining));
        }
      } catch (e) {
        console.error("Error analyzing pending offline translations:", e);
      }
    }
  }, []);

  // Listen for online events to flush offline queue
  useEffect(() => {
    window.addEventListener('online', processPendingQueue);
    if (navigator.onLine) {
      processPendingQueue();
    }
    return () => {
      window.removeEventListener('online', processPendingQueue);
    };
  }, [processPendingQueue]);

  const downloadAudio = async (url, e) => {
    e.stopPropagation();
    try {
      setDownloadProgress(prev => ({ ...prev, [url]: 1 }));
      const response = await fetch(url);
      if (!response.ok) throw new Error("Download failed");
      const reader = response.body.getReader();
      const contentLength = +response.headers.get('Content-Length');
      
      let receivedLength = 0;
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedLength += value.length;
        if (contentLength) {
          const pct = Math.round((receivedLength / contentLength) * 100);
          setDownloadProgress(prev => ({ ...prev, [url]: pct }));
        }
      }
      const blob = new Blob(chunks, { type: 'audio/mpeg' });
      await saveCachedAudio(url, blob);
      setCachedUrls(prev => ({ ...prev, [url]: true }));
      setDownloadProgress(prev => {
        const copy = { ...prev };
        delete copy[url];
        return copy;
      });
      alert("🎉 Audio downloaded successfully for offline listening.");
    } catch (err) {
      alert("Error downloading audio: " + err.message);
      setDownloadProgress(prev => {
        const copy = { ...prev };
        delete copy[url];
        return copy;
      });
    }
  };

  const handleDeleteCache = async (url, e) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to remove this downloaded audio?")) {
      await deleteCachedAudio(url);
      setCachedUrls(prev => {
        const copy = { ...prev };
        delete copy[url];
        return copy;
      });
    }
  };

  // --- PERSISTENCIA DE LA POSICIÓN DE DESPLAZAMIENTO (SCROLL POSITION) ---
  useEffect(() => {
    if (!currentDoc || !currentDoc.id) return;
    
    // Primero intentamos los valores de la base de datos (SQLite)
    const savedScrollPage = currentDoc.current_page || 1;
    const savedScrollPos = currentDoc.scroll_position || 0.0;
    
    let targetPage = savedScrollPage;
    let targetScroll = savedScrollPos;
    
    // Fallback a localStorage si los de la base de datos son los iniciales por defecto
    if (targetScroll === 0.0 && targetPage === 1) {
      const localScroll = localStorage.getItem(`scroll-position-${currentDoc.id}`);
      const localPage = localStorage.getItem(`current-page-${currentDoc.id}`);
      if (localScroll) targetScroll = parseFloat(localScroll) || 0.0;
      if (localPage) targetPage = parseInt(localPage, 10) || 1;
    }
    
    // Desactivar la restauración automática del scroll del navegador para evitar conflictos
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
    
    restorePageScroll(targetPage, targetScroll);

    let lastScrollSaveTime = 0;

    const saveImmediateScroll = (forcePage, forceScroll) => {
      if (isRestoringScrollRef.current) return;
      const currentDocVal = currentDocRef.current;
      if (!currentDocVal) return;
      const pageVal = forcePage !== undefined ? forcePage : (currentPageRef.current || 1);
      const audioTimeVal = getActiveAudioTimeForDoc();
      
      localStorage.setItem(`scroll-position-${currentDocVal.id}`, audioTimeVal.toString());
      localStorage.setItem(`current-page-${currentDocVal.id}`, pageVal.toString());
      
      syncReadingProgress(currentDocVal.id, pageVal, audioTimeVal);
    };

    const handleScroll = () => {
      if (isRestoringScrollRef.current) return;
      const now = Date.now();
      
      // 1. Medir las alturas de las páginas que están renderizadas actualmente
      const pageElements = document.querySelectorAll('[data-page-container]');
      let closestPageIdx = 0;
      let minDistance = Infinity;
      const viewportCenter = window.innerHeight / 2;

      pageElements.forEach(el => {
        const pIdx = parseInt(el.getAttribute('data-page-idx'), 10);
        const isPlaceholder = el.getAttribute('data-is-placeholder') === 'true';
        if (!isPlaceholder) {
          pageHeightsRef.current[pIdx] = el.getBoundingClientRect().height;
        }
        
        // Encontrar la página más cercana al centro del viewport
        const rect = el.getBoundingClientRect();
        const elementCenter = rect.top + rect.height / 2;
        const distance = Math.abs(elementCenter - viewportCenter);
        if (distance < minDistance) {
          minDistance = distance;
          closestPageIdx = pIdx;
        }
      });
      
      let newPage = closestPageIdx + 1;
      const currentDocVal = currentDocRef.current;
      if (currentDocVal) {
        const parts = currentDocVal.content.split('\n---\n');
        const textContent = parts[0] || '';
        const pageMatches = [...textContent.matchAll(/<!-- PAGE (\d+) -->/g)].map(m => parseInt(m[1], 10));
        if (pageMatches.length > 0) {
          if (closestPageIdx === 0) {
            newPage = Math.max(1, pageMatches[0] - 1);
          } else {
            newPage = pageMatches[closestPageIdx - 1] || closestPageIdx + 1;
          }
        }
      }
      if (newPage !== currentPageRef.current) {
        currentPageRef.current = newPage;
        setCurrentPage(newPage);
      }

      if (now - lastScrollSaveTime > 1500) {
        saveImmediateScroll(newPage, window.scrollY);
        lastScrollSaveTime = now;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveImmediateScroll(currentPageRef.current, window.scrollY);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('beforeunload', () => saveImmediateScroll(currentPageRef.current, window.scrollY));
    window.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      saveImmediateScroll(currentPageRef.current, window.scrollY); // Guardar posición del documento anterior al cambiar o salir
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('beforeunload', () => saveImmediateScroll(currentPageRef.current, window.scrollY));
      window.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentDoc?.id]);

  // Audiobooks derivados de documentos con language='audio', ordenados de forma ascendente por título
  const cloudAudiobooks = useMemo(() => {
    return documents
      .filter(d => d.language === 'audio')
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }));
  }, [documents]);
  const cloudBooks = useMemo(() => documents.filter(d => d.language !== 'audio' && d.language !== 'system'), [documents]);

  const [sidebarSections, setSidebarSections] = useState({ books: true, audios: true, folders: true });
  const [openAudioGroups, setOpenAudioGroups] = useState({});

  // Detects if the active audio belongs to a multi-track audiobook series
  const currentTrackGroup = useMemo(() => {
    if (!activeAudio) return null;
    const info = parseAudioSeries(activeAudio.title);
    const matchingTracks = cloudAudiobooks.filter(d => parseAudioSeries(d.title).series === info.series);
    if (matchingTracks.length <= 1) return null;
    matchingTracks.sort((a, b) => parseAudioSeries(a.title).trackNum - parseAudioSeries(b.title).trackNum);
    const currentIndex = matchingTracks.findIndex(d => d.audio_url === activeAudio.url);
    return {
      series: info.series,
      tracks: matchingTracks,
      currentIndex,
      hasPrev: currentIndex > 0,
      hasNext: currentIndex >= 0 && currentIndex < matchingTracks.length - 1
    };
  }, [activeAudio, cloudAudiobooks]);

  const currentTrackGroupRef = useRef(currentTrackGroup);
  useEffect(() => {
    currentTrackGroupRef.current = currentTrackGroup;
  }, [currentTrackGroup]);

  const handlePrevTrack = useCallback(() => {
    const group = currentTrackGroupRef.current;
    if (group && group.hasPrev) {
      const prevDoc = group.tracks[group.currentIndex - 1];
      setActiveAudio({ url: prevDoc.audio_url, title: prevDoc.title });
      setIsPlaying(true);
      showToast(`⏮ ${prevDoc.title}`);
    }
  }, []);

  const handleNextTrack = useCallback(() => {
    const group = currentTrackGroupRef.current;
    if (group && group.hasNext) {
      const nextDoc = group.tracks[group.currentIndex + 1];
      setActiveAudio({ url: nextDoc.audio_url, title: nextDoc.title });
      setIsPlaying(true);
      showToast(`⏭ ${nextDoc.title}`);
    }
  }, []);

  // Cargar caché local desde IndexedDB al arrancar
  useEffect(() => {
    const loadCachedUrls = async () => {
      try {
        const db = await getIDB();
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAllKeys();
        request.onsuccess = () => {
          const keys = request.result;
          const cacheMap = {};
          keys.forEach(k => { cacheMap[k] = true; });
          setCachedUrls(cacheMap);
          console.log("IndexedDB cached audiobooks loaded:", keys.length);
        };
      } catch (e) {
        console.warn("Error loading cached URLs:", e);
      }
    };
    loadCachedUrls();
  }, []);

  // Cargar diccionario offline en startup
  useEffect(() => {
    const loadDictionary = async () => {
      try {
        console.log("Cargando diccionario offline...");
        const res = await fetch('/dictionary_en_es.json');
        if (!res.ok) throw new Error("No se pudo cargar el diccionario.");
        const data = await res.json();
        setOfflineDict(data);
        console.log("Diccionario offline cargado con éxito.");
      } catch (err) {
        console.warn("⚠️ Error loading offline dictionary:", err);
      }
    };
    loadDictionary();
  }, []);

  // 1. Load documents and settings on startup
  useEffect(() => {
    const fetchDocs = async () => {
        try {
            let cloudDocs = [];
            try {
              const res = await fetch(getApiUrl('/api/documents'));
              if (res.ok) {
                const data = await res.json();
                cloudDocs = Array.isArray(data) ? data : [];
              } else {
                throw new Error(`HTTP ${res.status}`);
              }
            } catch (apiErr) {
              // Direct Supabase REST fallback if local backend is unreachable
              if (SUPABASE_URL && SUPABASE_ANON_KEY) {
                console.info("Backend API unreachable, fetching directly from Supabase REST...");
                try {
                  const sbRes = await fetchFromSupabase('documents?select=*');
                  if (sbRes && sbRes.ok) {
                    const sbData = await sbRes.json();
                    cloudDocs = Array.isArray(sbData) ? sbData : [];
                  }
                } catch (sbErr) {
                  console.warn("Supabase direct fetch error:", sbErr);
                }
              }
            }
            
            const demoDoc = {
              id: 'demo',
              title: 'Demo: German Podcast',
              content: rawTranscript,
              audio_url: '/podcast.mp3',
              language: 'de',
              created_at: new Date().toISOString()
            };
            const merged = [...cloudDocs, demoDoc];
            
            // Handle global settings
            let activeDocId = null;
            let activeAudioState = null;
            const globalSettingsDoc = cloudDocs.find(d => d.id === 'global_settings');
            if (globalSettingsDoc && globalSettingsDoc.content) {
              try {
                const parsed = JSON.parse(globalSettingsDoc.content);
                activeDocId = parsed.active_doc_id;
                activeAudioState = parsed.active_audio;
                if (Array.isArray(parsed.folders)) {
                  setFolders(parsed.folders);
                  localStorage.setItem('app-folders', JSON.stringify(parsed.folders));
                }
                if (parsed.doc_folders && typeof parsed.doc_folders === 'object') {
                  setDocFolders(parsed.doc_folders);
                  localStorage.setItem('app-doc-folders', JSON.stringify(parsed.doc_folders));
                }
              } catch (e) {
                console.warn("Failed to parse global settings:", e);
              }
            }
            
            // If no global settings doc was found, let's create it in database
            if (!globalSettingsDoc) {
              fetch(getApiUrl('/api/documents'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  id: 'global_settings',
                  title: 'Global Settings',
                  content: JSON.stringify({ active_doc_id: 'demo', active_audio: null }),
                  language: 'system'
                })
              }).catch(() => {
                if (SUPABASE_URL && SUPABASE_ANON_KEY) {
                  fetchFromSupabase('documents', {
                    method: 'POST',
                    body: JSON.stringify({
                      id: 'global_settings',
                      title: 'Global Settings',
                      content: JSON.stringify({ active_doc_id: 'demo', active_audio: null }),
                      language: 'system'
                    })
                  }).catch(() => {});
                }
              });
            }
            
            // Sync all database progress with local and global storage
            cloudDocs.forEach(doc => {
              if (doc.scroll_position > 0) {
                localStorage.setItem(`audio-progress-${cleanTitle(doc.title)}`, doc.scroll_position.toString());
              }
              if (doc.current_page > 0) {
                localStorage.setItem(`current-page-${doc.id}`, doc.current_page.toString());
              }
            });

            setDocuments(merged);
            isInitialDocsLoadedRef.current = true;

            // Restore active audio state
            let resolvedAudio = activeAudioState;
            if (!resolvedAudio) {
              const lastAudio = localStorage.getItem('last-active-audio');
              if (lastAudio) {
                try {
                  const parsed = JSON.parse(lastAudio);
                  if (parsed && parsed.url) resolvedAudio = parsed;
                } catch (e) {}
              }
            }
            if (!resolvedAudio && demoDoc.audio_url) {
              resolvedAudio = { url: demoDoc.audio_url, title: demoDoc.title };
            }

            if (resolvedAudio) {
              setActiveAudio(resolvedAudio);
              // Seek immediately if progress exists
              const associatedDoc = merged.find(d => isAudioMatchingDoc(resolvedAudio, d));
              if (associatedDoc && associatedDoc.scroll_position > 0) {
                setCurrentTime(associatedDoc.scroll_position);
                if (audioRef.current && audioRef.current.readyState >= 1) {
                  try {
                    audioRef.current.currentTime = associatedDoc.scroll_position;
                  } catch (e) {
                    console.warn("Error seeking immediately:", e);
                  }
                }
              }
            }

            // Restore active document
            let resolvedDoc = null;
            if (activeDocId) {
              resolvedDoc = merged.find(d => d.id === activeDocId);
            }
            if (!resolvedDoc) {
              const lastDoc = localStorage.getItem('last-opened-doc');
              if (lastDoc) {
                try {
                  const parsed = JSON.parse(lastDoc);
                  if (parsed && parsed.id) resolvedDoc = merged.find(d => d.id === parsed.id);
                } catch (e) {}
              }
            }
            if (!resolvedDoc) {
              const lastDocId = localStorage.getItem('last-opened-doc-id');
              if (lastDocId) resolvedDoc = merged.find(d => d.id === lastDocId);
            }
            if (!resolvedDoc) {
              resolvedDoc = merged[0] || demoDoc;
            }

            if (resolvedDoc) {
              setCurrentDoc(resolvedDoc);
              localStorage.setItem('last-opened-doc', JSON.stringify(resolvedDoc));
              localStorage.setItem('last-opened-doc-id', resolvedDoc.id);
              
              const targetPage = resolvedDoc.current_page || 1;
              const targetScroll = resolvedDoc.scroll_position || 0.0;
              restorePageScroll(targetPage, targetScroll, resolvedDoc);

              // Auto-decouple: only activate audio if the document actually has audio
              const docAudio = findAudioForDoc(resolvedDoc, merged);
              if (docAudio) {
                setActiveAudio(docAudio);
              } else {
                setActiveAudio(null);
                setIsPlaying(false);
              }
            }
        } catch (err) {
            console.warn("⚠️ Could not load documents:", err);
        }
    };
    fetchDocs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Save document (Supports text, language and optional audio attachment)
  const handleSaveDocument = async () => {
    if (!newTitle || !newContent) return alert("Please enter title and content.");
    setIsSaving(true);
    
    try {
        let uploadedAudioUrl = null;

        // Si el usuario adjuntó un archivo de audio al texto manual
        if (manualAudioFile && SUPABASE_URL && SUPABASE_ANON_KEY) {
          const cleanKey = sanitizeStorageKey(manualAudioFile.name);
          const storagePath = `audios/${Date.now()}_${cleanKey}`;
          uploadedAudioUrl = await uploadToSupabaseStorage(manualAudioFile, storagePath);
        }

        let newDoc;
        const chosenLang = manualLang || 'fr';
        try {
          const res = await fetch(getApiUrl('/api/documents'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                title: newTitle.trim(), 
                content: newContent, 
                language: chosenLang,
                audio_url: uploadedAudioUrl
              })
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          newDoc = await res.json();
          if (newDoc.error) throw new Error(newDoc.error);
        } catch (apiErr) {
          if (SUPABASE_URL && SUPABASE_ANON_KEY) {
            const directId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            const payload = {
              id: directId,
              title: newTitle.trim(),
              content: newContent,
              language: chosenLang,
              audio_url: uploadedAudioUrl,
              created_at: new Date().toISOString()
            };
            const directRes = await fetchFromSupabase('documents', {
              method: 'POST',
              headers: { 'Prefer': 'return=representation' },
              body: JSON.stringify(payload)
            });
            if (directRes && directRes.ok) {
              const resJson = await directRes.json();
              newDoc = Array.isArray(resJson) ? resJson[0] : payload;
            } else {
              throw apiErr;
            }
          } else {
            throw apiErr;
          }
        }
        
        if (selectedFolder) {
          const nextDocFolders = { ...docFolders, [newDoc.id]: selectedFolder };
          syncFolders(folders, nextDocFolders);
        }

        setDocuments(prev => [newDoc, ...prev]);
        setCurrentDoc(newDoc);
        if (uploadedAudioUrl) {
          setActiveAudio({
            url: uploadedAudioUrl,
            title: newDoc.title
          });
        }

        setShowAddModal(false);
        setNewTitle("");
        setNewContent("");
        setManualAudioFile(null);
        setSelectedFolder("");
    } catch (err) {
        alert("Error saving: " + err.message);
    } finally {
        setIsSaving(false);
    }
  };

  // 2b. Update existing document (title, content, language, and optional audio attachment)
  const handleUpdateDocument = async () => {
    if (!editModalDoc) return;
    if (!editDocTitle.trim()) return alert("Document title cannot be empty.");
    setIsSavingEdit(true);
    setEditAudioProgress(0);

    try {
      let finalAudioUrl = editModalDoc.audio_url || null;

      // Si el usuario seleccionó un nuevo archivo de audio para adjuntar al documento
      if (editDocAudioFile && SUPABASE_URL && SUPABASE_ANON_KEY) {
        const cleanKey = sanitizeStorageKey(editDocAudioFile.name);
        const storagePath = `audios/${Date.now()}_${cleanKey}`;
        finalAudioUrl = await uploadToSupabaseStorage(editDocAudioFile, storagePath, (pct) => {
          setEditAudioProgress(pct);
        });
      }

      const updatedPayload = {
        title: editDocTitle.trim(),
        content: editDocContent,
        language: editDocLang || 'fr',
        audio_url: finalAudioUrl
      };

      let updatedDoc = { ...editModalDoc, ...updatedPayload };

      try {
        const res = await fetch(getApiUrl(`/api/documents/${editModalDoc.id}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedPayload)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const resData = await res.json();
        if (resData && !resData.error) updatedDoc = { ...updatedDoc, ...resData };
      } catch (apiErr) {
        if (SUPABASE_URL && SUPABASE_ANON_KEY) {
          await fetchFromSupabase(`documents?id=eq.${editModalDoc.id}`, {
            method: 'PATCH',
            body: JSON.stringify(updatedPayload)
          });
        } else {
          throw apiErr;
        }
      }

      // Actualizar estado local
      setDocuments(prev => prev.map(d => d.id === editModalDoc.id ? updatedDoc : d));
      if (currentDoc?.id === editModalDoc.id) {
        setCurrentDoc(updatedDoc);
      }
      if (activeAudio?.url === editModalDoc.audio_url || (finalAudioUrl && activeAudio?.title === editModalDoc.title)) {
        setActiveAudio(finalAudioUrl ? { url: finalAudioUrl, title: updatedDoc.title } : null);
      } else if (finalAudioUrl && !activeAudio) {
        setActiveAudio({ url: finalAudioUrl, title: updatedDoc.title });
      }

      setEditModalDoc(null);
      setEditDocAudioFile(null);
      alert("✅ Document updated successfully.");
    } catch (err) {
      alert("Error updating document: " + err.message);
    } finally {
      setIsSavingEdit(false);
      setEditAudioProgress(0);
    }
  };

  // 2b. Import PDF via Supabase Storage (bypasses Vercel 4.5MB limit)
  const handleImportPdf = async () => {
    if (!pdfFile) return alert("Please select a PDF file.");
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return alert("Supabase is not configured. Please check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
    }
    setImportingPdf(true);
    setPdfUploadProgress(0);

    try {
      // 1. Upload PDF to Supabase Storage with sanitized key
      const cleanKey = sanitizeStorageKey(pdfFile.name);
      const storagePath = `pdfs/${Date.now()}_${cleanKey}`;
      await uploadToSupabaseStorage(pdfFile, storagePath, (pct) => setPdfUploadProgress(pct));

      // 2. Call backend to extract text and save in Supabase
      const defaultTitle = pdfFile.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
      const finalTitle = pdfTitle.trim() || defaultTitle;

      const res = await fetch(getApiUrl('/api/process-storage-pdf'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          storage_path: storagePath, 
          filename: pdfFile.name, 
          title: finalTitle,
          language: pdfLang 
        })
      });
      const savedDoc = await res.json();
      if (savedDoc.error) throw new Error(savedDoc.error);

      if (selectedFolder) {
        const nextDocFolders = { ...docFolders, [savedDoc.id]: selectedFolder };
        syncFolders(folders, nextDocFolders);
      }

      setDocuments(prev => [savedDoc, ...prev]);
      setCurrentDoc(savedDoc);
      setShowAddModal(false);
      setPdfFile(null);
      setPdfTitle('');
      setSelectedFolder('');
      setPdfAudioUrl('');
      setPdfUploadProgress(0);

      // Pre-cache highlighted words in background
      const parts = (savedDoc.content || '').split('\n---\n');
      const wordsPart = parts[1] || '';
      const highlights = wordsPart.split(',').map(w => ({ word: w.trim(), context: '' })).filter(h => h.word);
      if (highlights.length > 0) preCacheWords(highlights, pdfLang);

      alert(`🎉 PDF "${finalTitle}" imported successfully. Found ${highlights.length} highlighted words.`);
    } catch (e) {
      alert("Error importing PDF: " + e.message);
    } finally {
      setImportingPdf(false);
      setPdfUploadProgress(0);
    }
  };

  // 2c. Upload audio to Supabase Storage and register in database (Multi-file support)
  const handleUploadAudio = async () => {
    if (audioFiles.length === 0) return alert("Please select at least one audio file.");
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return alert("Supabase is not configured. Please check environment variables.");
    }
    setUploadingAudio(true);
    setUploadProgress(0);

    let firstUploadedDoc = null;
    const uploadedDocs = [];

    try {
      for (let i = 0; i < audioFiles.length; i++) {
        const file = audioFiles[i];
        setUploadStatusMsg(`Uploading file ${i + 1} of ${audioFiles.length} (${file.name}): 0%`);
        setUploadProgress(0);

        // 1. Upload audio directly to Supabase Storage
        const cleanKey = sanitizeStorageKey(file.name);
        const storagePath = `audios/${Date.now()}_${i}_${cleanKey}`;
        await uploadToSupabaseStorage(file, storagePath, (pct) => {
          setUploadProgress(pct);
          setUploadStatusMsg(`Uploading file ${i + 1} of ${audioFiles.length} (${file.name}): ${pct}%`);
        });

        setUploadStatusMsg(`Registering file ${i + 1} of ${audioFiles.length}...`);

        // 2. Register metadata in Supabase via backend or direct REST fallback
        const title = (audioFiles.length === 1 && audioTitle.trim()) 
          ? audioTitle.trim() 
          : file.name.replace(/\.[^.]+$/, '');

        let newDoc;
        try {
          const res = await fetch(getApiUrl('/api/register-audio'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: file.name, title, storage_path: storagePath })
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          newDoc = await res.json();
          if (newDoc.error) throw new Error(newDoc.error);
        } catch (apiErr) {
          if (SUPABASE_URL && SUPABASE_ANON_KEY) {
            const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/media/${storagePath}`;
            const directId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `audio_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            const payload = {
              id: directId,
              title,
              content: "",
              language: 'audio',
              audio_url: publicUrl,
              created_at: new Date().toISOString()
            };
            const directRes = await fetchFromSupabase('documents', {
              method: 'POST',
              headers: { 'Prefer': 'return=representation' },
              body: JSON.stringify(payload)
            });
            if (directRes && directRes.ok) {
              const resJson = await directRes.json();
              newDoc = Array.isArray(resJson) ? resJson[0] : payload;
            } else {
              throw apiErr;
            }
          } else {
            throw apiErr;
          }
        }

        uploadedDocs.push(newDoc);
        setDocuments(prev => [newDoc, ...prev]);
        if (i === 0) {
          firstUploadedDoc = newDoc;
        }
      }

      if (selectedFolder && uploadedDocs.length > 0) {
        const nextDocFolders = { ...docFolders };
        uploadedDocs.forEach(d => {
          nextDocFolders[d.id] = selectedFolder;
        });
        syncFolders(folders, nextDocFolders);
      }

      setShowAddModal(false);
      setAudioFiles([]);
      setAudioTitle('');
      setSelectedFolder('');
      setUploadProgress(0);
      setUploadStatusMsg('');

      // Activate first uploaded audio in list
      if (firstUploadedDoc) {
        setActiveAudio({ url: firstUploadedDoc.audio_url, title: firstUploadedDoc.title });
      }
    } catch (e) {
      alert("Error uploading audio: " + e.message);
    } finally {
      setUploadingAudio(false);
      setUploadProgress(0);
      setUploadStatusMsg('');
    }
  };

  const preCacheWords = async (highlights, lang) => {
    const ANALYZE_URL = getApiUrl('/api/analyze');
    for (const h of highlights) {
      const searchWord = h.word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").trim().toLowerCase();
      if (!searchWord) continue;
      try {
        // Consultar API SQLite Local
        const cacheRes = await fetch(getApiUrl(`/api/word_cache?word=${searchWord}&language=${lang}`));
        const cached = await cacheRes.json();

        if (!cached) {
          const res = await fetch(ANALYZE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ word: searchWord, context: h.context })
          });
          const apiData = await res.json();
          if (!apiData.error) {
            // Guardar en la API SQLite Local
            await fetch(getApiUrl('/api/word_cache'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                word: searchWord,
                language: lang,
                translation_data: apiData
              })
            });
          }
        }
      } catch (err) {
        console.error("Error pre-caching word:", searchWord, err);
      }
    }
  };

  // --- GESTIÓN Y CARGA DE VOCABULARIO ---
  const loadVocabularyList = useCallback(async (lang = vocabLanguageFilter) => {
    setIsLoadingVocab(true);
    let loaded = false;
    try {
      const url = lang && lang !== 'all' 
        ? getApiUrl(`/api/word_cache?language=${lang}`) 
        : getApiUrl('/api/word_cache');
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setCachedVocabList(data);
          loaded = true;
        }
      }
    } catch (e) {
      // Backend local no disponible
    }

    // Direct fallback to Supabase Cloud Database si el backend local no está corriendo
    if (!loaded) {
      try {
        let endpoint = 'word_cache?select=*&order=created_at.desc';
        if (lang && lang !== 'all') {
          endpoint += `&language=ilike.${lang}`;
        }
        const sRes = await fetchFromSupabase(endpoint);
        if (sRes && sRes.ok) {
          const sData = await sRes.json();
          if (Array.isArray(sData)) {
            const parsedRows = sData.map(row => {
              if (typeof row.translation_data === 'string') {
                try { row.translation_data = JSON.parse(row.translation_data); } catch (_) {}
              }
              return row;
            });
            setCachedVocabList(parsedRows);
          }
        }
      } catch (sErr) {
        console.error("Error consultando Supabase directamente:", sErr);
      }
    }

    setIsLoadingVocab(false);
  }, [vocabLanguageFilter]);

  useEffect(() => {
    if (showVocabModal) {
      loadVocabularyList(vocabLanguageFilter);
    }
  }, [showVocabModal, vocabLanguageFilter, loadVocabularyList]);

  // Auto-cargar el audio del documento si este tiene uno enlazado al cambiar y guardar el último documento abierto
  useEffect(() => {
    if (!currentDoc) return;
    
    // Guardar en localStorage
    if (currentDoc.id) {
      localStorage.setItem('last-opened-doc-id', currentDoc.id);
      localStorage.setItem('last-opened-doc', JSON.stringify(currentDoc));
    }

    if (isInitRef.current) {
      if (currentDoc.audio_url) {
        setActiveAudio({
          url: currentDoc.audio_url.startsWith('http') || currentDoc.audio_url.startsWith('/') 
            ? currentDoc.audio_url 
            : getApiUrl(currentDoc.audio_url),
          title: currentDoc.title
        });
      }
    } else {
      isInitRef.current = true;
    }

    if (isInitialDocsLoadedRef.current && currentDoc.id !== 'global_settings') {
      syncGlobalSettings(currentDoc.id, activeAudio);
    }
  }, [currentDoc?.id, currentDoc?.audio_url]);

  // Sincronizar velocidad de reproducción dinámicamente cuando cambie
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, activeAudio]);

  // Restaurar el último audiolibro activo al montar la PWA
  useEffect(() => {
    const lastAudio = localStorage.getItem('last-active-audio');
    if (lastAudio) {
      try {
        const parsed = JSON.parse(lastAudio);
        if (parsed && parsed.url && parsed.title) {
          setActiveAudio(parsed);
        }
      } catch (e) {
        console.warn("No se pudo restaurar el último audio activo:", e);
      }
    }
  }, []);

  // Guardar el último audiolibro activo cuando cambie
  useEffect(() => {
    if (activeAudio) {
      localStorage.setItem('last-active-audio', JSON.stringify(activeAudio));
      if (isInitialDocsLoadedRef.current && currentDoc && currentDoc.id !== 'global_settings') {
        syncGlobalSettings(currentDoc.id, activeAudio);
      }
    }
  }, [activeAudio]);

  // Reset progress restoration flag when active audio changes
  useEffect(() => {
    hasRestoredAudioRef.current = false;
  }, [activeAudio?.url]);

  // Reactive audio position restoration that resolves startup timing and race conditions
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || hasRestoredAudioRef.current) return;
    
    // Only restore if initial documents have loaded from SQLite/Supabase and audio metadata is ready
    if (isInitialDocsLoadedRef.current && audio.readyState >= 1 && activeAudio && activeAudio.title) {
      const associatedDoc = documents.find(d => isAudioMatchingDoc(activeAudio, d));
      let seekTime = 0;
      if (associatedDoc && associatedDoc.scroll_position > 0) {
        seekTime = associatedDoc.scroll_position;
      } else {
        const savedTime = localStorage.getItem(`audio-progress-${cleanTitle(activeAudio.title)}`);
        if (savedTime) {
          const parsedTime = parseFloat(savedTime);
          if (!isNaN(parsedTime)) {
            seekTime = parsedTime;
          }
        }
      }

      if (seekTime > 0) {
        try {
          audio.currentTime = seekTime;
          audio.playbackRate = playbackRate;
          setCurrentTime(seekTime);
          hasRestoredAudioRef.current = true;
          console.log("⚓️ Reactively restored playback position to:", seekTime);
        } catch (err) {
          console.warn("Failed reactively seeking audio:", err);
        }
      } else {
        // If seekTime is 0, count as restored (no seeking needed)
        hasRestoredAudioRef.current = true;
      }
    }
  }, [documents, activeAudio, audioSrc, playbackRate]);

  // 3. Audio listeners (Podcast / Audiolibros desacoplados) con rendimiento optimizado (Throttling)
  useEffect(() => {
    setIsPlaying(false);
    setDuration(0);
    const audio = audioRef.current;
    if (!audio) return;
    
    // Cargar la nueva fuente
    audio.load();

    const saveImmediateAudioProgress = (timeToSave) => {
      if (!isInitialDocsLoadedRef.current) return; // Evitar que valores obsoletos locales pisen la BD al iniciar
      const currentActiveAudio = activeAudioRef.current;
      const currentDocVal = currentDocRef.current;
      if (currentActiveAudio && currentActiveAudio.title && timeToSave !== undefined) {
        // Prevent saving 0 or progress updates when the audio element has been reset (readyState < 1)
        if (audio && audio.readyState >= 1) {
          localStorage.setItem(`audio-progress-${cleanTitle(currentActiveAudio.title)}`, timeToSave.toString());
          const associatedDoc = documentsRef.current.find(d => isAudioMatchingDoc(currentActiveAudio, d));
          if (associatedDoc) {
            const pageVal = (currentDocVal && currentDocVal.id === associatedDoc.id) ? (currentPageRef.current || 1) : (associatedDoc.current_page || 1);
            syncReadingProgress(associatedDoc.id, pageVal, timeToSave);
          }
        }
      }
    };

    // Cargar progreso del activeAudio y setearlo en el estado síncronamente
    let initialSeekTime = 0;
    const currentActiveAudio = activeAudioRef.current;
    if (currentActiveAudio && currentActiveAudio.title) {
      const associatedDoc = documentsRef.current.find(d => isAudioMatchingDoc(currentActiveAudio, d));
      if (associatedDoc && associatedDoc.scroll_position > 0) {
        initialSeekTime = associatedDoc.scroll_position;
      } else {
        const savedTime = localStorage.getItem(`audio-progress-${cleanTitle(currentActiveAudio.title)}`);
        if (savedTime) {
          const parsedTime = parseFloat(savedTime);
          if (!isNaN(parsedTime)) {
            initialSeekTime = parsedTime;
          }
        }
      }
    }
    setCurrentTime(initialSeekTime);

    let hasSeeked = false;
    const restoreProgress = () => {
      if (hasSeeked) return;
      
      // Calcular el tiempo de seek de forma completamente dinámica para evitar closures obsoletos de React
      let seekTime = 0;
      const activeAudioVal = activeAudioRef.current;
      if (activeAudioVal && activeAudioVal.title) {
        const associatedDoc = documentsRef.current.find(d => isAudioMatchingDoc(activeAudioVal, d));
        if (associatedDoc && associatedDoc.scroll_position > 0) {
          seekTime = associatedDoc.scroll_position;
        } else {
          const savedTime = localStorage.getItem(`audio-progress-${cleanTitle(activeAudioVal.title)}`);
          if (savedTime) {
            const parsedTime = parseFloat(savedTime);
            if (!isNaN(parsedTime)) {
              seekTime = parsedTime;
            }
          }
        }
      }

      if (seekTime > 0) {
        try {
          audio.currentTime = seekTime;
          audio.playbackRate = playbackRate;
          hasSeeked = true;
          setCurrentTime(seekTime);
          console.log("Restored playback position dynamically to:", seekTime);
        } catch (err) {
          console.warn("Failed to seek audio:", err);
        }
      }
    };

    // Intentar restaurar progreso inmediatamente si los metadatos ya están cargados síncronamente
    if (initialSeekTime > 0 && audio.readyState >= 1) {
      restoreProgress();
    }

    // Inicializar con la hora actual en lugar de 0 para bloquear el primer tick inmediato de sobreescritura
    let lastSaveTime = Date.now();
    const updateTime = () => {
      if (isDraggingRef.current) return;
      const time = audio.currentTime;
      setCurrentTime(time);
      
      const now = Date.now();
      if (now - lastSaveTime > 2000) {
        saveImmediateAudioProgress(time);
        lastSaveTime = now;
      }
    };
    
    const updateDuration = () => {
      setDuration(audio.duration);
      audio.playbackRate = playbackRate; // Re-aplicar velocidad al cargar metadatos
      restoreProgress();
    };

    const onCanPlay = () => {
      restoreProgress();
    };

    const onEnded = () => {
      setIsPlaying(false);
      saveImmediateAudioProgress(audio.currentTime);
      const group = currentTrackGroupRef.current;
      if (group && group.hasNext) {
        const nextDoc = group.tracks[group.currentIndex + 1];
        setActiveAudio({ url: nextDoc.audio_url, title: nextDoc.title });
        setIsPlaying(true);
        showToast(`⏭ Auto-playing: ${nextDoc.title}`);
      }
    };

    const onPause = () => {
      saveImmediateAudioProgress(audio.currentTime);
    };

    const handleUnloadSave = () => {
      saveImmediateAudioProgress(audio.currentTime);
    };

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('pause', onPause);
    window.addEventListener('beforeunload', handleUnloadSave);
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        saveImmediateAudioProgress(audio.currentTime);
      }
    });

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('pause', onPause);
      window.removeEventListener('beforeunload', handleUnloadSave);
    };
  }, [audioSrc]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      // Fallback: Si el currentTime está en 0, pero hay progreso guardado, restaurarlo justo antes de reproducir
      const currentActiveAudio = activeAudioRef.current;
      if (audio.currentTime === 0 && currentActiveAudio && currentActiveAudio.title) {
        const associatedDoc = documentsRef.current.find(d => isAudioMatchingDoc(currentActiveAudio, d));
        const savedTime = associatedDoc && associatedDoc.scroll_position > 0 ? associatedDoc.scroll_position.toString() : localStorage.getItem(`audio-progress-${cleanTitle(currentActiveAudio.title)}`);
        if (savedTime) {
          const parsedTime = parseFloat(savedTime);
          if (!isNaN(parsedTime)) {
            if (audio.readyState >= 1) {
              audio.currentTime = parsedTime;
              setCurrentTime(parsedTime);
            }
          }
        }
      }
      audio.play();
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
      const currentActiveAudio = activeAudioRef.current;
      const currentDocVal = currentDocRef.current;
      if (currentActiveAudio && currentActiveAudio.title && audio.readyState >= 1) {
        const timeToSave = audio.currentTime;
        localStorage.setItem(`audio-progress-${cleanTitle(currentActiveAudio.title)}`, timeToSave.toString());
        const associatedDoc = documentsRef.current.find(d => isAudioMatchingDoc(currentActiveAudio, d));
        if (associatedDoc) {
          const pageVal = (currentDocVal && currentDocVal.id === associatedDoc.id) ? (currentPageRef.current || 1) : (associatedDoc.current_page || 1);
          syncReadingProgress(associatedDoc.id, pageVal, timeToSave);
        }
      }
    }
  };

  const handleAudioMetadataLoaded = (e) => {
    const audio = e.currentTarget;
    setDuration(audio.duration);
    audio.playbackRate = playbackRate;

    // Restaurar progreso síncronamente en cuanto el elemento cargue los metadatos
    const currentActiveAudio = activeAudioRef.current;
    if (currentActiveAudio && currentActiveAudio.title) {
      const associatedDoc = documentsRef.current.find(d => isAudioMatchingDoc(currentActiveAudio, d));
      const savedTime = associatedDoc && associatedDoc.scroll_position > 0 ? associatedDoc.scroll_position.toString() : localStorage.getItem(`audio-progress-${cleanTitle(currentActiveAudio.title)}`);
      if (savedTime) {
        const parsedTime = parseFloat(savedTime);
        if (!isNaN(parsedTime)) {
          try {
            audio.currentTime = parsedTime;
            setCurrentTime(parsedTime);
          } catch (err) {
            console.warn("handleAudioMetadataLoaded: could not seek yet", err);
          }
        }
      }
    }
  };

  const skipTime = (s) => {
    const audio = audioRef.current;
    if (!audio) return;
    const newTime = Math.min(Math.max(audio.currentTime + s, 0), duration);
    audio.currentTime = newTime;
    setCurrentTime(newTime);
    const currentActiveAudio = activeAudioRef.current;
    const currentDocVal = currentDocRef.current;
    if (currentActiveAudio && currentActiveAudio.title) {
      localStorage.setItem(`audio-progress-${cleanTitle(currentActiveAudio.title)}`, newTime.toString());
      const associatedDoc = documentsRef.current.find(d => isAudioMatchingDoc(currentActiveAudio, d));
      if (associatedDoc) {
        const pageVal = (currentDocVal && currentDocVal.id === associatedDoc.id) ? (currentPageRef.current || 1) : (associatedDoc.current_page || 1);
        syncReadingProgress(associatedDoc.id, pageVal, newTime);
      }
    }
  };
  
  // --- CONTROL DE REPRODUCTOR FLUIDO (SMOOTH SCRUBBING) ---
  const handleSeekStart = () => {
    setIsDragging(true);
  };

  const handleSeek = (e) => {
    const t = parseFloat(e.target.value);
    setCurrentTime(t);
  };

  const handleSeekEnd = (e) => {
    const t = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = t;
    }
    setCurrentTime(t);
    setIsDragging(false);
    
    // Guardar progreso en localStorage de forma inmediata al terminar de arrastrar
    const currentActiveAudio = activeAudioRef.current;
    const currentDocVal = currentDocRef.current;
    if (currentActiveAudio && currentActiveAudio.title) {
      localStorage.setItem(`audio-progress-${cleanTitle(currentActiveAudio.title)}`, t.toString());
      const associatedDoc = documentsRef.current.find(d => isAudioMatchingDoc(currentActiveAudio, d));
      if (associatedDoc) {
        const pageVal = (currentDocVal && currentDocVal.id === associatedDoc.id) ? (currentPageRef.current || 1) : (associatedDoc.current_page || 1);
        syncReadingProgress(associatedDoc.id, pageVal, t);
      }
    }
  };

  const formatTime = (t) => { if (isNaN(t)) return "0:00"; const m = Math.floor(t / 60); const s = Math.floor(t % 60); return `${m}:${s < 10 ? '0' : ''}${s}`; };

  // --- PREVISUALIZACIÓN DE TIEMPO (SEEK HOVER) ---
  const handleProgressBarMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    
    // Compensate for the physical 12px width of the slider thumb
    // The clickable track range is from 6px to (width - 6px)
    const thumbWidth = 12;
    const halfThumb = thumbWidth / 2;
    let pct = 0;
    
    if (rect.width > thumbWidth) {
      pct = Math.max(0, Math.min(1, (x - halfThumb) / (rect.width - thumbWidth)));
    } else {
      pct = Math.max(0, Math.min(1, x / (rect.width || 1)));
    }
    
    const time = pct * duration;
    setHoverTime(time);
    setHoverX(x);
  };

  const handleProgressBarMouseLeave = () => {
    setHoverTime(null);
  };

  // 4. PRONUNCIACIÓN DE PALABRA CON VOCES PREMIUM/NEURONALES NATIVAS
  const playWordAudio = (word, targetLang = null) => {
      if (!word) return;
      // Detenemos cualquier audio anterior
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(word);
      
      // Obtener el código de idioma adecuado (priorizar targetLang explícito)
      const langToCheck = (targetLang || (currentDoc && currentDoc.language) || 'fr').toLowerCase();
      let langCode = 'fr-FR'; // Default sensible para francés
      if (langToCheck.startsWith('fr')) langCode = 'fr-FR';
      else if (langToCheck.startsWith('en')) langCode = 'en-US';
      else if (langToCheck.startsWith('de')) langCode = 'de-DE';
      else if (langToCheck.startsWith('es')) langCode = 'es-ES';
      else if (langToCheck.startsWith('it')) langCode = 'it-IT';
      
      utterance.lang = langCode;
      utterance.rate = 0.9; // Un poco más lento para claridad

      // Obtener voces del navegador y buscar la de mejor calidad
      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length > 0) {
        // Filtrar voces que coincidan con nuestro idioma
        const langVoices = voices.filter(v => v.lang.toLowerCase().startsWith(langCode.substring(0, 2).toLowerCase()));
        if (langVoices.length > 0) {
          // Intentar buscar una voz premium o de alta fidelidad basada en palabras clave del nombre
          const premiumKeywords = ['google', 'natural', 'enhanced', 'siri', 'premium', 'samantha', 'helena', 'daniel'];
          let selectedVoice = null;
          
          for (const keyword of premiumKeywords) {
            selectedVoice = langVoices.find(v => v.name.toLowerCase().includes(keyword));
            if (selectedVoice) break;
          }
          
          // Si no se encontró ninguna que contenga las palabras clave, usar la primera voz local o la primera disponible del idioma
          if (!selectedVoice) {
            selectedVoice = langVoices.find(v => v.localService) || langVoices[0];
          }
          
          if (selectedVoice) {
            utterance.voice = selectedVoice;
            console.log(`Using selected high-quality voice: ${selectedVoice.name} (${selectedVoice.lang})`);
          }
        }
      }

      window.speechSynthesis.speak(utterance);
  };

  const handleCloseModal = useCallback(async () => {
    isPopupClosedByUser.current = true;
    
    // Abort active fetch request if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    if (isLoading && selectedWord) {
      const clickedWord = selectedWord.word;
      const associatedPhrase = selectedWord.associatedPhrase;
      
      if (associatedPhrase) {
        // Unhighlight the phrase in the DOM immediately
        const pKey = associatedPhrase.pKey;
        const startIdx = associatedPhrase.startIdx;
        const endIdx = associatedPhrase.endIdx;
        const paragraphSpans = document.querySelectorAll(`[data-paragraph-key="${pKey}"][data-word-flat-idx]`);
        paragraphSpans.forEach(span => {
          const idx = parseInt(span.getAttribute('data-word-flat-idx'), 10);
          const spacer = document.querySelector(`[data-paragraph-key="${pKey}"][data-space-after-idx="${idx}"]`);
          if (idx >= startIdx && idx <= endIdx) {
            span.removeAttribute('data-is-highlighted');
            span.style.backgroundColor = 'transparent';
            span.style.color = 'inherit';
            span.style.borderBottom = 'none';
            span.style.fontWeight = '400';
            span.style.padding = '0';
            if (spacer) {
              spacer.removeAttribute('data-is-highlighted');
              spacer.style.backgroundColor = 'transparent';
              spacer.style.borderBottom = 'none';
            }
          }
        });
        
        // Remove from document content
        if (currentDoc) {
          const parts = currentDoc.content.split('\n---\n');
          const textContent = parts[0] || '';
          const highlightedWordsPart = parts[1] || '';
          const highlightedWords = highlightedWordsPart 
            ? highlightedWordsPart.split(',').map(w => w.trim().toLowerCase()) 
            : [];
          
          const phraseTag = `phrase:${pKey}:${startIdx}-${endIdx}:${associatedPhrase.phraseText.toLowerCase()}`;
          const newHighlightedWords = highlightedWords.filter(w => w !== phraseTag);
          
          const newHighlightedPart = newHighlightedWords.join(', ');
          const newContent = `${textContent}\n---\n${newHighlightedPart}`;
          const updatedDoc = { ...currentDoc, content: newContent };
          
          setCurrentDoc(updatedDoc);
          setDocuments(prev => prev.map(d => d.id === currentDoc.id ? updatedDoc : d));
          
          if (currentDoc.id !== 'demo') {
            fetch(getApiUrl(`/api/documents/${currentDoc.id}`), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: newContent })
            }).catch(err => console.warn("Error updating document highlights on cancel phrase:", err));
          }
        }
      } else if (clickedWord) {
        // Unhighlight the word in the DOM immediately
        const searchWord = clickedWord.toLowerCase();
        const elements = document.querySelectorAll(`[data-word-clean="${searchWord}"]`);
        elements.forEach(el => {
          el.style.backgroundColor = 'transparent';
          el.style.color = 'inherit';
          el.style.borderBottom = 'none';
          el.style.fontWeight = '400';
          el.style.padding = '0';
          el.removeAttribute('data-is-highlighted');
        });
        
        // Remove from document content
        if (currentDoc) {
          const parts = currentDoc.content.split('\n---\n');
          const textContent = parts[0] || '';
          const highlightedWordsPart = parts[1] || '';
          const highlightedWords = highlightedWordsPart 
            ? highlightedWordsPart.split(',').map(w => w.trim().toLowerCase()) 
            : [];
          
          const newHighlightedWords = highlightedWords.filter(w => w !== searchWord);
          
          const newHighlightedPart = newHighlightedWords.join(', ');
          const newContent = `${textContent}\n---\n${newHighlightedPart}`;
          const updatedDoc = { ...currentDoc, content: newContent };
          
          setCurrentDoc(updatedDoc);
          setDocuments(prev => prev.map(d => d.id === currentDoc.id ? updatedDoc : d));
          
          if (currentDoc.id !== 'demo') {
            fetch(getApiUrl(`/api/documents/${currentDoc.id}`), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: newContent })
            }).catch(err => console.warn("Error updating document highlights on cancel word:", err));
          }
        }
      }
    }
    
    setSelectedWord(null);
    setIsLoading(false);
  }, [isLoading, selectedWord, currentDoc]);

  // 5. LÓGICA DE PALABRA
  const handleWordClick = useCallback(async (clickedWord, surroundingSentence) => {
    // Strip leading and trailing punctuation/symbols using Unicode Property Escapes
    const cleanWord = clickedWord
      .replace(/^[^\p{L}\p{N}]+/u, "")
      .replace(/[^\p{L}\p{N}]+$/u, "")
      .trim();
    if (!cleanWord) return;
    
    const searchWord = cleanWord.toLowerCase(); 
    isPopupClosedByUser.current = false;

    // Immediately style elements in the DOM to avoid freeze/latency of React render
    const elements = document.querySelectorAll(`[data-word-clean="${searchWord}"]`);
    elements.forEach(el => {
      el.style.backgroundColor = 'rgba(255, 179, 64, 0.2)'; // theme.highlightBg
      el.style.color = '#FFD60A'; // theme.highlightText
      el.style.borderBottom = '1px solid rgba(255, 214, 10, 0.3)'; // theme.highlightBorder
      el.style.fontWeight = '500';
      el.style.padding = '0 2px';
      el.setAttribute('data-is-highlighted', 'true');
    });

    // Detect if this clicked word is part of an active phrase highlight
    let associatedPhrase = null;
    const pKey = dragParagraphKey.current;
    const flatIdx = dragStartFlatIdx.current;
    const isPhrase = searchWord.includes(' ');
    
    if (currentDoc && !isPhrase && pKey !== null && flatIdx !== null) {
      const parts = currentDoc.content.split('\n---\n');
      const highlightedWordsPart = parts[1] || '';
      const highlightedWords = highlightedWordsPart 
        ? highlightedWordsPart.split(',').map(w => w.trim().toLowerCase()) 
        : [];
      
      for (const w of highlightedWords) {
        if (w.startsWith('phrase:')) {
          const phraseParts = w.split(':');
          const phrasePKey = phraseParts[1];
          const range = phraseParts[2];
          const phraseText = phraseParts.slice(3).join(':');
          if (phrasePKey === pKey) {
            const [start, end] = range.split('-').map(Number);
            if (flatIdx >= start && flatIdx <= end) {
              associatedPhrase = {
                fullKey: w,
                pKey: phrasePKey,
                startIdx: start,
                endIdx: end,
                phraseText: phraseText
              };
              break;
            }
          }
        }
      }
    }

    // 1. Agregar el highlight al documento actual si no está ya resaltado (solo para palabras individuales)
    if (currentDoc && !isPhrase) {
      const parts = currentDoc.content.split('\n---\n');
      const textContent = parts[0] || '';
      const highlightedWordsPart = parts[1] || '';
      const highlightedWords = highlightedWordsPart 
        ? highlightedWordsPart.split(',').map(w => w.trim().toLowerCase()) 
        : [];
      
      if (!highlightedWords.includes(searchWord)) {
        const newHighlightedPart = highlightedWords.concat(searchWord).join(', ');
        const newContent = `${textContent}\n---\n${newHighlightedPart}`;
        const updatedDoc = { ...currentDoc, content: newContent };
        
        // Update document state synchronously
        setCurrentDoc(updatedDoc);
        setDocuments(prev => prev.map(d => d.id === currentDoc.id ? updatedDoc : d));
        
        if (currentDoc.id !== 'demo') {
          fetch(getApiUrl(`/api/documents/${currentDoc.id}`), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: newContent })
          }).catch(err => {
            console.warn("Error saving highlight to SQLite, queuing update:", err);
            const pendingDocs = localStorage.getItem('pending-document-updates');
            let docsMap = {};
            try {
              if (pendingDocs) docsMap = JSON.parse(pendingDocs);
            } catch (ex) {}
            docsMap[currentDoc.id] = newContent;
            localStorage.setItem('pending-document-updates', JSON.stringify(docsMap));
          });
        }
      }
    }

    setIsLoading(true);
    modalOpenedTime.current = Date.now();
    setSelectedWord({ word: cleanWord, es: "...", en: "...", examples: [], associatedPhrase });

    // 2. Si el modo offline está activo (manual o por falta de red), ir directo al diccionario local
    if (isAppOffline) {
        const pendingTrans = localStorage.getItem('pending-offline-translations');
        let list = [];
        try {
          if (pendingTrans) list = JSON.parse(pendingTrans);
          if (!Array.isArray(list)) list = [];
        } catch (err) {}
        
        const exists = list.some(item => item.word === searchWord && item.language === (currentDoc?.language || 'auto'));
        if (!exists) {
          list.push({
            word: searchWord,
            context: surroundingSentence,
            language: currentDoc?.language || 'auto',
            mode: isDetailedMode ? 'detailed' : 'simple'
          });
          localStorage.setItem('pending-offline-translations', JSON.stringify(list));
        }

        // Buscar en el diccionario offline
        const isEnglish = (currentDoc?.language || 'en').startsWith('en');
        if (isEnglish && offlineDict) {
          const lookupKey = searchWord.toLowerCase();
          const lemma = offlineDict.lemmas[lookupKey];
          const baseWord = lemma || lookupKey;
          const entry = offlineDict.words[baseWord];
          
          if (entry) {
            setSelectedWord({
              word: cleanWord,
              es: entry.es,
              en: baseWord,
              grammar: entry.grammar || "Vocabulario (Offline)",
              alternatives: entry.alternatives || [],
              examples: entry.examples || [],
              associatedPhrase,
              fromCache: false,
              isOfflineDict: true
            });
            setIsLoading(false);
            return;
          }
        }

        setSelectedWord({
          word: cleanWord,
          es: "Modo offline activo. Palabra guardada.",
          en: "Offline mode active. Word saved.",
          grammar: "Se procesará al desactivar modo offline y estar online",
          examples: [],
          associatedPhrase,
          fromCache: false,
          isOfflineSaved: true
        });
        setIsLoading(false);
        return;
    }

    // CACHÉ
    try {
        let cached = null;
        try {
            const cacheRes = await fetch(getApiUrl(`/api/word_cache?word=${searchWord}&language=${currentDoc?.language || 'auto'}`));
            if (cacheRes.ok) {
                cached = await cacheRes.json();
            }
        } catch (_) {}

        // Fallback directo a Supabase Cloud Database si el backend local no responde
        if (!cached) {
            try {
                const sLang = (currentDoc?.language || '').trim().toLowerCase();
                let filter = `word=ilike.${encodeURIComponent(searchWord)}`;
                if (sLang && sLang !== 'auto') {
                    filter += `&language=ilike.${sLang}`;
                }
                let sRes = await fetchFromSupabase(`word_cache?${filter}&limit=1`);
                if ((!sRes || !sRes.ok) && sLang && sLang !== 'auto') {
                    // Si no hubo coincidencia con el filtro exacto de idioma, buscar solo por palabra
                    sRes = await fetchFromSupabase(`word_cache?word=ilike.${encodeURIComponent(searchWord)}&limit=1`);
                }
                if (sRes && sRes.ok) {
                    const sRows = await sRes.json();
                    if (sRows && sRows.length > 0) {
                        cached = sRows[0];
                        if (typeof cached.translation_data === 'string') {
                            try { cached.translation_data = JSON.parse(cached.translation_data); } catch (_) {}
                        }
                    }
                }
            } catch (_) {}
        }

        if (cached && cached.translation_data) {
            if (isPopupClosedByUser.current) return;
            setSelectedWord({ word: cleanWord, ...cached.translation_data, associatedPhrase, fromCache: true });
            setIsLoading(false);
            return;
        }
    } catch (err) { console.error("Error caché:", err); }

    // API
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    const API_URL = getApiUrl('/api/analyze');
    try {
      let apiData = null;
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortControllerRef.current.signal,
          body: JSON.stringify({ 
            word: searchWord, 
            context: surroundingSentence,
            language: currentDoc?.language || 'auto',
            mode: isDetailedMode ? 'detailed' : 'simple'
          })
        });
        if (!res.ok) throw new Error(`Backend error: ${res.status}`);
        const parsed = await res.json();
        if (parsed.error) throw new Error(parsed.error);
        apiData = parsed;
      } catch (backendErr) {
        if (backendErr.name === 'AbortError') return;
        // Direct client fallback to Gemini API if local backend is down or unreachable
        apiData = await analyzeWordViaGemini(
          searchWord,
          surroundingSentence,
          currentDoc?.language || 'auto',
          isDetailedMode ? 'detailed' : 'simple'
        );
      }

      if (isPopupClosedByUser.current) return;
      setSelectedWord({ word: cleanWord, ...apiData, associatedPhrase, fromCache: false });

      // Guardar en caché (Backend y Supabase)
      try {
        let savedToBackend = false;
        try {
          const cRes = await fetch(getApiUrl('/api/word_cache'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  word: searchWord,
                  language: currentDoc?.language || 'auto',
                  translation_data: apiData
              })
          });
          if (cRes.ok) savedToBackend = true;
        } catch (_) {}

        if (!savedToBackend) {
          // Direct fallback to Supabase
          await fetchFromSupabase('word_cache', {
            method: 'POST',
            headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
            body: JSON.stringify({
              word: searchWord.toLowerCase(),
              language: (currentDoc?.language || 'fr').toLowerCase(),
              translation_data: apiData
            })
          });
        }
      } catch (dbErr) {
        console.warn("Could not cache word in database:", dbErr);
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (isPopupClosedByUser.current) return;
      
      const isOffline = !navigator.onLine || e.message.includes("fetch") || e.message.includes("Failed to fetch");
      if (isOffline) {
        const pendingTrans = localStorage.getItem('pending-offline-translations');
        let list = [];
        try {
          if (pendingTrans) list = JSON.parse(pendingTrans);
          if (!Array.isArray(list)) list = [];
        } catch (err) {}
        
        const exists = list.some(item => item.word === searchWord && item.language === (currentDoc?.language || 'auto'));
        if (!exists) {
          list.push({
            word: searchWord,
            context: surroundingSentence,
            language: currentDoc?.language || 'auto',
            mode: isDetailedMode ? 'detailed' : 'simple'
          });
          localStorage.setItem('pending-offline-translations', JSON.stringify(list));
        }

        // Search offline dictionary if loaded
        const isEnglish = (currentDoc?.language || 'en').startsWith('en');
        if (isEnglish && offlineDict) {
          const lookupKey = searchWord.toLowerCase();
          const lemma = offlineDict.lemmas[lookupKey];
          const baseWord = lemma || lookupKey;
          const entry = offlineDict.words[baseWord];
          
          if (entry) {
            setSelectedWord({
              word: cleanWord,
              es: entry.es,
              en: baseWord,
              grammar: entry.grammar || "Vocabulary (Offline)",
              alternatives: entry.alternatives || [],
              examples: entry.examples || [],
              associatedPhrase,
              fromCache: false,
              isOfflineDict: true
            });
            return;
          }
        }

        setSelectedWord({
          word: cleanWord,
          es: "Offline mode active. Word saved.",
          en: "Offline mode active. Word saved.",
          grammar: "Will be processed when connection is restored",
          examples: [],
          associatedPhrase,
          fromCache: false,
          isOfflineSaved: true
        });
      } else {
        setSelectedWord({ word: cleanWord, es: "Error", en: "Connection Error", grammar: "Check your connection", examples: [], associatedPhrase, fromCache: false });
      }
    } finally {
      if (!isPopupClosedByUser.current) {
        setIsLoading(false);
      }
    }
  }, [currentDoc, isDetailedMode, offlineDict]);

  const handleRefreshTranslation = useCallback(async () => {
    if (!selectedWord) return;
    setIsLoading(true);
    isPopupClosedByUser.current = false;
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    const searchWord = selectedWord.word.toLowerCase();
    const context = dragParagraphText.current || "";
    
    if (isAppOffline) {
        const pendingTrans = localStorage.getItem('pending-offline-translations');
        let list = [];
        try {
          if (pendingTrans) list = JSON.parse(pendingTrans);
          if (!Array.isArray(list)) list = [];
        } catch (err) {}
        
        const exists = list.some(item => item.word === searchWord && item.language === (currentDoc?.language || 'auto'));
        if (!exists) {
          list.push({
            word: searchWord,
            context: context,
            language: currentDoc?.language || 'auto',
            mode: isDetailedMode ? 'detailed' : 'simple'
          });
          localStorage.setItem('pending-offline-translations', JSON.stringify(list));
        }

        const isEnglish = (currentDoc?.language || 'en').startsWith('en');
        if (isEnglish && offlineDict) {
          const lookupKey = searchWord.toLowerCase();
          const lemma = offlineDict.lemmas[lookupKey];
          const baseWord = lemma || lookupKey;
          const entry = offlineDict.words[baseWord];
          
          if (entry) {
            setSelectedWord({
              word: selectedWord.word,
              es: entry.es,
              en: baseWord,
              grammar: entry.grammar || "Vocabulario (Offline)",
              alternatives: entry.alternatives || [],
              examples: entry.examples || [],
              associatedPhrase: selectedWord.associatedPhrase,
              fromCache: false,
              isOfflineDict: true
            });
            setIsLoading(false);
            return;
          }
        }

        setSelectedWord({
          word: selectedWord.word,
          es: "Modo offline activo. Palabra guardada.",
          en: "Offline mode active. Word saved.",
          grammar: "Se procesará al desactivar modo offline y estar online",
          examples: [],
          associatedPhrase: selectedWord.associatedPhrase,
          fromCache: false,
          isOfflineSaved: true
        });
        setIsLoading(false);
        return;
    }

    const API_URL = getApiUrl('/api/analyze');
    try {
      let apiData = null;
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortControllerRef.current.signal,
          body: JSON.stringify({ 
            word: searchWord, 
            context: context,
            language: currentDoc?.language || 'auto',
            mode: isDetailedMode ? 'detailed' : 'simple'
          })
        });
        if (!res.ok) throw new Error(`Backend error: ${res.status}`);
        const parsed = await res.json();
        if (parsed.error) throw new Error(parsed.error);
        apiData = parsed;
      } catch (backendErr) {
        if (backendErr.name === 'AbortError') return;
        // Direct client fallback to Gemini API if local backend is down or unreachable
        apiData = await analyzeWordViaGemini(
          searchWord,
          context,
          currentDoc?.language || 'auto',
          isDetailedMode ? 'detailed' : 'simple'
        );
      }

      if (isPopupClosedByUser.current) return;
      setSelectedWord({ 
        word: selectedWord.word, 
        ...apiData, 
        associatedPhrase: selectedWord.associatedPhrase, 
        fromCache: false 
      });

      // Update cache in database
      try {
        await fetch(getApiUrl('/api/word_cache'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                word: searchWord,
                language: currentDoc?.language || 'auto',
                translation_data: apiData
            })
        });
      } catch (dbErr) {
        console.warn("Could not cache word in database:", dbErr);
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (isPopupClosedByUser.current) return;
      
      const isOffline = !navigator.onLine || e.message.includes("fetch") || e.message.includes("Failed to fetch");
      if (isOffline) {
        const pendingTrans = localStorage.getItem('pending-offline-translations');
        let list = [];
        try {
          if (pendingTrans) list = JSON.parse(pendingTrans);
          if (!Array.isArray(list)) list = [];
        } catch (err) {}
        
        const exists = list.some(item => item.word === searchWord && item.language === (currentDoc?.language || 'auto'));
        if (!exists) {
          list.push({
            word: searchWord,
            context: context,
            language: currentDoc?.language || 'auto',
            mode: isDetailedMode ? 'detailed' : 'simple'
          });
          localStorage.setItem('pending-offline-translations', JSON.stringify(list));
        }

        // Search offline dictionary if loaded
        const isEnglish = (currentDoc?.language || 'en').startsWith('en');
        if (isEnglish && offlineDict) {
          const lookupKey = searchWord.toLowerCase();
          const lemma = offlineDict.lemmas[lookupKey];
          const baseWord = lemma || lookupKey;
          const entry = offlineDict.words[baseWord];
          
          if (entry) {
            setSelectedWord({
              word: selectedWord.word,
              es: entry.es,
              en: baseWord,
              grammar: entry.grammar || "Vocabulary (Offline)",
              alternatives: entry.alternatives || [],
              examples: entry.examples || [],
              associatedPhrase: selectedWord.associatedPhrase,
              fromCache: false,
              isOfflineDict: true
            });
            return;
          }
        }

        setSelectedWord({
          word: selectedWord.word,
          es: "Offline mode active. Word saved.",
          en: "Offline mode active. Word saved.",
          grammar: "Will be processed when connection is restored",
          examples: [],
          associatedPhrase: selectedWord.associatedPhrase,
          fromCache: false,
          isOfflineSaved: true
        });
      } else {
        setSelectedWord({ 
          word: selectedWord.word, 
          es: "Error", 
          en: "Connection Error", 
          grammar: "Check your connection", 
          examples: [], 
          associatedPhrase: selectedWord.associatedPhrase, 
          fromCache: false 
        });
      }
    } finally {
      if (!isPopupClosedByUser.current) {
        setIsLoading(false);
      }
    }
  }, [selectedWord, currentDoc, isDetailedMode, offlineDict]);

  const handleWordLongPress = useCallback(async (clickedWord, surroundingSentence) => {
    const cleanWord = clickedWord
      .replace(/^[^\p{L}\p{N}]+/u, "")
      .replace(/[^\p{L}\p{N}]+$/u, "")
      .trim();
    if (!cleanWord) return;
    
    const searchWord = cleanWord.toLowerCase();

    // 1. Quitar el highlight del documento actual
    // Immediately un-style elements in the DOM to avoid freeze/latency of React render
    const elements = document.querySelectorAll(`[data-word-clean="${searchWord}"]`);
    elements.forEach(el => {
      el.style.backgroundColor = 'transparent';
      el.style.color = 'inherit';
      el.style.borderBottom = 'none';
      el.style.fontWeight = '400';
      el.style.padding = '0';
      el.removeAttribute('data-is-highlighted');
    });

    if (currentDoc) {
      const parts = currentDoc.content.split('\n---\n');
      const textContent = parts[0] || '';
      const highlightedWordsPart = parts[1] || '';
      const highlightedWords = highlightedWordsPart 
        ? highlightedWordsPart.split(',').map(w => w.trim().toLowerCase()) 
        : [];
      
      // Filter out this single word, AND any multi-word phrase highlights that contain this word!
      const newHighlightedWords = highlightedWords.filter(w => {
        if (w === searchWord) return false;
        
        if (w.startsWith('phrase:')) {
          const parts = w.split(':');
          const pKey = parts[1];
          const range = parts[2];
          const phraseText = parts.slice(3).join(':');
          const phraseCleanWords = phraseText.split(' ');
          if (phraseCleanWords.includes(searchWord)) {
            // Unhighlight all constituent words of this precise deleted phrase in the DOM too!
            const [startIdx, endIdx] = range.split('-').map(Number);
            const paragraphSpans = document.querySelectorAll(`[data-paragraph-key="${pKey}"][data-word-flat-idx]`);
            paragraphSpans.forEach(span => {
              const idx = parseInt(span.getAttribute('data-word-flat-idx'), 10);
              const spacer = document.querySelector(`[data-paragraph-key="${pKey}"][data-space-after-idx="${idx}"]`);
              if (idx >= startIdx && idx <= endIdx) {
                span.removeAttribute('data-is-highlighted');
                span.style.backgroundColor = 'transparent';
                span.style.color = 'inherit';
                span.style.borderBottom = 'none';
                span.style.fontWeight = '400';
                span.style.padding = '0';
                if (spacer) {
                  spacer.removeAttribute('data-is-highlighted');
                  spacer.style.backgroundColor = 'transparent';
                  spacer.style.borderBottom = 'none';
                }
              }
            });
            // Eliminar la frase de la base de datos de caché de vocabulario (word_cache)
            fetch(getApiUrl(`/api/word_cache?word=${phraseText.toLowerCase()}&language=${currentDoc?.language || 'auto'}`), {
              method: 'DELETE'
            }).catch(err => console.error("Error al eliminar frase de SQLite:", err));
            return false;
          }
        } else if (w.includes(' ')) {
          const phraseWords = w.split(' ');
          if (phraseWords.includes(searchWord)) {
            // Immediately unhighlight all other constituent words of this legacy deleted phrase in the DOM too!
            phraseWords.forEach(phWord => {
              const phElements = document.querySelectorAll(`[data-word-clean="${phWord}"]`);
              phElements.forEach(el => {
                el.style.backgroundColor = 'transparent';
                el.style.color = 'inherit';
                el.style.borderBottom = 'none';
                el.style.fontWeight = '400';
                el.style.padding = '0';
                el.removeAttribute('data-is-highlighted');
              });
            });
            // Eliminar la frase de la base de datos de caché de vocabulario (word_cache)
            fetch(getApiUrl(`/api/word_cache?word=${w}&language=${currentDoc?.language || 'auto'}`), {
              method: 'DELETE'
            }).catch(err => console.error("Error al eliminar frase de SQLite:", err));
            return false;
          }
        }
        return true;
      });
      
      const newHighlightedPart = newHighlightedWords.join(', ');
      const newContent = `${textContent}\n---\n${newHighlightedPart}`;
      const updatedDoc = { ...currentDoc, content: newContent };
      
      // Update document state synchronously
      setCurrentDoc(updatedDoc);
      setDocuments(prev => prev.map(d => d.id === currentDoc.id ? updatedDoc : d));
      
      if (currentDoc.id !== 'demo') {
        // Guardar asíncronamente en SQLite
        fetch(getApiUrl(`/api/documents/${currentDoc.id}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: newContent })
        }).catch(err => console.warn("Error updating document highlights on delete:", err));
      }
    }

    // 2. Eliminar la palabra de la base de datos de caché de vocabulario (word_cache) de fondo (no bloqueante)
    fetch(getApiUrl(`/api/word_cache?word=${searchWord}&language=${currentDoc?.language || 'auto'}`), {
      method: 'DELETE'
    }).catch(err => console.error("Error al eliminar palabra de SQLite:", err));
    
    // Si la palabra eliminada es la que está seleccionada actualmente en el popup, limpiamos la selección de inmediato
    setSelectedWord(prev => (prev && prev.word.toLowerCase() === searchWord) ? null : prev);
    console.log(`Eliminada de la base de datos de fondo: ${searchWord}`);
  }, [currentDoc]);

  // --- DRAG SELECTION HANDLERS ---
  const handleWordDragMove = useCallback((clientX, clientY) => {
    if (!isSelectingRange.current) return;
    const element = document.elementFromPoint(clientX, clientY);
    if (!element) return;
    
    let wordSpan = element.closest('[data-word-flat-idx]');
    if (!wordSpan) {
      // Snapping logic: if the cursor drifts slightly off vertically, elementFromPoint returns
      // the paragraph container <p>. We can query all child spans in the active paragraph and find
      // the one physically closest to the pointer!
      const pKey = dragParagraphKey.current;
      if (pKey) {
        const spans = document.querySelectorAll(`[data-paragraph-key="${pKey}"][data-word-flat-idx]`);
        let closestSpan = null;
        let minDistance = Infinity;
        
        spans.forEach(span => {
          const rect = span.getBoundingClientRect();
          // Distance from clientX, clientY to bounding rect of the span
          const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
          const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist < minDistance) {
            minDistance = dist;
            closestSpan = span;
          }
        });
        
        if (minDistance < 50) { // Only snap if within 50px boundary
          wordSpan = closestSpan;
        }
      }
    }
    
    if (!wordSpan) return;
    
    const pKey = wordSpan.getAttribute('data-paragraph-key');
    if (pKey !== dragParagraphKey.current) return;
    
    const endIdx = parseInt(wordSpan.getAttribute('data-word-flat-idx'), 10);
    if (endIdx === lastProcessedIdx.current) return;
    lastProcessedIdx.current = endIdx;
    
    const startIdx = dragStartFlatIdx.current;
    if (startIdx === null || isNaN(endIdx)) return;
    
    const minIdx = Math.min(startIdx, endIdx);
    const maxIdx = Math.max(startIdx, endIdx);
    
    const paragraphSpans = document.querySelectorAll(`[data-paragraph-key="${pKey}"][data-word-flat-idx]`);
    const selectedWordsList = [];
    
    paragraphSpans.forEach(span => {
      const idx = parseInt(span.getAttribute('data-word-flat-idx'), 10);
      const clean = span.getAttribute('data-word-clean');
      const raw = span.getAttribute('data-word-raw');
      
      const spacer = document.querySelector(`[data-paragraph-key="${pKey}"][data-space-after-idx="${idx}"]`);
      
      if (idx >= minIdx && idx <= maxIdx) {
        // Style as active blue drag highlight in the DOM
        span.style.backgroundColor = 'rgba(10, 132, 255, 0.25)';
        span.style.color = '#FFD60A';
        span.style.borderBottom = '1.5px solid rgba(255, 214, 10, 0.3)';
        span.style.fontWeight = '400';
        span.style.padding = '0';
        span.setAttribute('data-is-dragging', 'true');
        
        if (clean) {
          selectedWordsList.push({ clean, raw, idx });
        }
        
        if (spacer && idx < maxIdx) {
          spacer.style.backgroundColor = 'rgba(10, 132, 255, 0.25)';
          spacer.style.borderBottom = '1.5px solid rgba(255, 214, 10, 0.3)';
        } else if (spacer) {
          const wasSpacerHighlighted = spacer.getAttribute('data-is-highlighted') === 'true';
          if (wasSpacerHighlighted) {
            spacer.style.backgroundColor = 'rgba(255, 179, 64, 0.2)';
            spacer.style.borderBottom = '1.5px solid rgba(255, 214, 10, 0.3)';
          } else {
            spacer.style.backgroundColor = 'transparent';
            spacer.style.borderBottom = 'none';
          }
        }
      } else {
        // Clean up dragging styles and restore highlighted/transparent styles
        span.removeAttribute('data-is-dragging');
        const wasHighlighted = span.getAttribute('data-is-highlighted') === 'true';
        
        if (wasHighlighted) {
          span.style.backgroundColor = 'rgba(255, 179, 64, 0.2)';
          span.style.color = '#FFD60A';
          span.style.borderBottom = '1.5px solid rgba(255, 214, 10, 0.3)';
          span.style.fontWeight = '400';
          span.style.padding = '0';
        } else {
          span.style.backgroundColor = 'transparent';
          span.style.color = 'inherit';
          span.style.borderBottom = 'none';
          span.style.fontWeight = '400';
          span.style.padding = '0';
        }
        
        if (spacer) {
          const wasSpacerHighlighted = spacer.getAttribute('data-is-highlighted') === 'true';
          if (wasSpacerHighlighted) {
            spacer.style.backgroundColor = 'rgba(255, 179, 64, 0.2)';
            spacer.style.borderBottom = '1px solid rgba(255, 214, 10, 0.3)';
          } else {
            spacer.style.backgroundColor = 'transparent';
            spacer.style.borderBottom = 'none';
          }
        }
      }
    });
    
    draggedWordsRef.current = selectedWordsList;
  }, []);

  const handleWordDragEnd = useCallback(async () => {
    if (!isSelectingRange.current) return;
    
    isSelectingRange.current = false;
    const wasDragging = isDraggingSelection.current;
    isDraggingSelection.current = false;
    
    if (wasDragging && draggedWordsRef.current.length > 0) {
      const sortedWords = [...draggedWordsRef.current].sort((a, b) => a.idx - b.idx);
      const rawPhrase = sortedWords.map(w => w.raw).join(' ');
      const cleanWords = sortedWords.map(w => w.clean);
      const surroundingParagraph = dragParagraphText.current || "";
      
      // Save multi-word drag highlight unified as a single paragraph-confined precise highlight key
      const phrase = cleanWords.join(' ');
      
      const minIdx = Math.min(...sortedWords.map(w => w.idx));
      const maxIdx = Math.max(...sortedWords.map(w => w.idx));
      
      if (!currentDoc || !phrase) return;
      
      const parts = currentDoc.content.split('\n---\n');
      const textContent = parts[0] || '';
      const highlightedWordsPart = parts[1] || '';
      const highlightedWords = highlightedWordsPart 
        ? highlightedWordsPart.split(',').map(w => w.trim().toLowerCase()) 
        : [];
      
      const precisePhraseKey = `phrase:${dragParagraphKey.current}:${minIdx}-${maxIdx}:${phrase}`;
      
      // Check if this precise phrase or legacy phrase is already highlighted
      const isAlreadyHighlighted = highlightedWords.some(w => {
        if (w.startsWith('phrase:')) {
          const parts = w.split(':');
          const pKey = parts[1];
          const phraseText = parts.slice(3).join(':');
          return pKey === dragParagraphKey.current && phraseText === phrase;
        }
        return w === phrase;
      });
      
      if (isAlreadyHighlighted) {
        // Toggle OFF: Unhighlight and delete
        // 1. Instantly unstyle elements in the current paragraph in the DOM
        const paragraphSpans = document.querySelectorAll(`[data-paragraph-key="${dragParagraphKey.current}"][data-word-flat-idx]`);
        paragraphSpans.forEach(span => {
          const idx = parseInt(span.getAttribute('data-word-flat-idx'), 10);
          const spacer = document.querySelector(`[data-paragraph-key="${dragParagraphKey.current}"][data-space-after-idx="${idx}"]`);
          
          span.removeAttribute('data-is-dragging');
          
          if (idx >= minIdx && idx <= maxIdx) {
            span.removeAttribute('data-is-highlighted');
            span.style.backgroundColor = 'transparent';
            span.style.color = 'inherit';
            span.style.borderBottom = 'none';
            span.style.fontWeight = '400';
            span.style.padding = '0';
            
            if (spacer) {
              spacer.removeAttribute('data-is-highlighted');
              spacer.style.backgroundColor = 'transparent';
              spacer.style.borderBottom = 'none';
            }
          }
        });
        
        // 2. Perform background state updates and SQLite delete
        const newHighlightedWords = highlightedWords.filter(w => {
          if (w.startsWith('phrase:')) {
            const parts = w.split(':');
            const pKey = parts[1];
            const phraseText = parts.slice(3).join(':');
            return !(pKey === dragParagraphKey.current && phraseText === phrase);
          }
          return w !== phrase;
        });
        
        const newHighlightedPart = newHighlightedWords.join(', ');
        const newContent = `${textContent}\n---\n${newHighlightedPart}`;
        const updatedDoc = { ...currentDoc, content: newContent };
        
        // Update document state synchronously
        setCurrentDoc(updatedDoc);
        setDocuments(prev => prev.map(d => d.id === currentDoc.id ? updatedDoc : d));
        
        if (currentDoc.id !== 'demo') {
          fetch(getApiUrl(`/api/documents/${currentDoc.id}`), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: newContent })
          }).catch(err => console.warn("Error saving drag highlight to SQLite:", err));
        }
        
        return;
      }
      
      // 1. Instantly style all constituents of the phrase as permanently highlighted yellow in the DOM
      const paragraphSpans = document.querySelectorAll(`[data-paragraph-key="${dragParagraphKey.current}"][data-word-flat-idx]`);
      paragraphSpans.forEach(span => {
        const idx = parseInt(span.getAttribute('data-word-flat-idx'), 10);
        const spacer = document.querySelector(`[data-paragraph-key="${dragParagraphKey.current}"][data-space-after-idx="${idx}"]`);
        
        span.removeAttribute('data-is-dragging');
        
        if (idx >= minIdx && idx <= maxIdx) {
          span.style.backgroundColor = 'rgba(255, 179, 64, 0.2)';
          span.style.color = '#FFD60A';
          span.style.borderBottom = '1.5px solid rgba(255, 214, 10, 0.3)';
          span.style.fontWeight = '500';
          span.style.padding = '0';
          span.setAttribute('data-is-highlighted', 'true');
          
          if (spacer) {
            if (idx < maxIdx) {
              spacer.style.backgroundColor = 'rgba(255, 179, 64, 0.2)';
              spacer.style.borderBottom = '1.5px solid rgba(255, 214, 10, 0.3)';
              spacer.setAttribute('data-is-highlighted', 'true');
            } else {
              spacer.style.backgroundColor = 'transparent';
              spacer.style.borderBottom = 'none';
              spacer.removeAttribute('data-is-highlighted');
            }
          }
        }
      });
      
      // 2. Perform background state updates and SQLite save
      if (!highlightedWords.includes(precisePhraseKey)) {
        const newHighlightedPart = highlightedWords.concat(precisePhraseKey).join(', ');
        const newContent = `${textContent}\n---\n${newHighlightedPart}`;
        const updatedDoc = { ...currentDoc, content: newContent };
        
        // Update document state synchronously
        setCurrentDoc(updatedDoc);
        setDocuments(prev => prev.map(d => d.id === currentDoc.id ? updatedDoc : d));
        
        if (currentDoc.id !== 'demo') {
          fetch(getApiUrl(`/api/documents/${currentDoc.id}`), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: newContent })
          }).catch(err => console.warn("Error saving drag highlight to SQLite:", err));
        }
      }
      
      // 3. Trigger translation popup for the joint phrase
      const translateQuery = rawPhrase.trim();
      if (translateQuery) {
        handleWordClick(translateQuery, surroundingParagraph);
      }
    } else {
      // Clean up any remaining drag styles in the DOM
      const draggingSpans = document.querySelectorAll('[data-is-dragging]');
      draggingSpans.forEach(span => {
        span.removeAttribute('data-is-dragging');
        const wasHighlighted = span.getAttribute('data-is-highlighted') === 'true';
        if (wasHighlighted) {
          span.style.backgroundColor = 'rgba(255, 179, 64, 0.2)';
          span.style.color = '#FFD60A';
          span.style.borderBottom = '1px solid rgba(255, 214, 10, 0.3)';
          span.style.fontWeight = '500';
          span.style.padding = '0 2px';
        } else {
          span.style.backgroundColor = 'transparent';
          span.style.color = 'inherit';
          span.style.borderBottom = 'none';
          span.style.fontWeight = '400';
          span.style.padding = '0';
        }
      });
      
      // Also clean up dragging spacers
      const pKey = dragParagraphKey.current;
      if (pKey) {
        const spacers = document.querySelectorAll(`[data-paragraph-key="${pKey}"][data-space-after-idx]`);
        spacers.forEach(spacer => {
          const wasSpacerHighlighted = spacer.getAttribute('data-is-highlighted') === 'true';
          if (wasSpacerHighlighted) {
            spacer.style.backgroundColor = 'rgba(255, 179, 64, 0.2)';
            spacer.style.borderBottom = '1px solid rgba(255, 214, 10, 0.3)';
          } else {
            spacer.style.backgroundColor = 'transparent';
            spacer.style.borderBottom = 'none';
          }
        });
      }
    }
  }, [currentDoc, handleWordClick]);

  useEffect(() => {
    const handleGlobalMove = (e) => {
      if (!isSelectingRange.current) return;

      const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
      const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;

      const startCoords = dragStartCoords.current;
      if (!startCoords) return;

      const dx = Math.abs(clientX - startCoords.x);
      const dy = Math.abs(clientY - startCoords.y);
      const distance = Math.sqrt(dx * dx + dy * dy);

      // On touch: if vertical movement dominates (scroll gesture), abort selection entirely
      // and let the browser handle native scrolling
      if (e.type === 'touchmove' && dy > 8 && dy > dx * 1.2) {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
        touchScrollAborted.current = true;
        isSelectingRange.current = false;
        isDraggingSelection.current = false;
        setTempDraggedWords([]);
        return; // Let browser scroll natively
      }

      // It's a drag (horizontal or diagonal) — block scroll and treat as selection
      if (e.cancelable) {
        e.preventDefault();
      }

      if (distance > 10) {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
        isDraggingSelection.current = true;
        handleWordDragMove(clientX, clientY);
      }
    };

    const handleGlobalEnd = (e) => {
      if (!isSelectingRange.current) return;
      
      // If touch was aborted as a scroll, skip click/drag logic
      if (e.type === 'touchend' && touchScrollAborted.current) {
        touchScrollAborted.current = false;
        isSelectingRange.current = false;
        isDraggingSelection.current = false;
        isLongPress.current = false;
        activeSingleWord.current = null;
        lastProcessedIdx.current = null;
        return;
      }

      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      
      if (e.type === 'mouseup' && e.button !== 0) return;
      
      if (isDraggingSelection.current) {
        handleWordDragEnd();
      } else if (!isLongPress.current) {
        if (activeSingleWord.current && dragParagraphText.current) {
          handleWordClick(activeSingleWord.current, dragParagraphText.current);
        }
      }
      
      isSelectingRange.current = false;
      isDraggingSelection.current = false;
      isLongPress.current = false;
      activeSingleWord.current = null;
      lastProcessedIdx.current = null;
    };

    // Use non-passive listeners to allow e.preventDefault() to function correctly
    window.addEventListener('mousemove', handleGlobalMove, { passive: false });
    window.addEventListener('touchmove', handleGlobalMove, { passive: false });
    window.addEventListener('mouseup', handleGlobalEnd);
    window.addEventListener('touchend', handleGlobalEnd);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMove);
      window.removeEventListener('touchmove', handleGlobalMove);
      window.removeEventListener('mouseup', handleGlobalEnd);
      window.removeEventListener('touchend', handleGlobalEnd);
    };
  }, [handleWordDragMove, handleWordDragEnd, handleWordClick]);

  const memoizedBookContent = useMemo(() => {
    if (!currentDoc) {
      return <div style={{ textAlign: 'center', marginTop: '100px', opacity: 0.5 }}>Loading text...</div>;
    }

    const parts = currentDoc.content.split('\n---\n');
    const textContent = parts[0] || '';
    const highlightedWordsPart = parts[1] || '';
    const highlightedWords = highlightedWordsPart ? highlightedWordsPart.split(',').map(w => w.trim().toLowerCase()) : [];
    
    // Split into global single-word highlights, paragraph-confined phrase highlights, and legacy global phrase highlights
    const singleWordHighlights = [];
    const paragraphPhraseHighlights = [];
    const legacyGlobalPhraseHighlights = [];
    
    highlightedWords.forEach(w => {
      if (!w) return;
      if (w.startsWith('phrase:')) {
        const parts = w.split(':');
        const pKey = parts[1];
        const range = parts[2];
        const phraseText = parts.slice(3).join(':');
        const [startIdx, endIdx] = range.split('-').map(Number);
        paragraphPhraseHighlights.push({ pKey, startIdx, endIdx, phraseText, fullKey: w });
      } else if (w.includes(' ')) {
        legacyGlobalPhraseHighlights.push(w);
      } else {
        singleWordHighlights.push(w);
      }
    });

    // Dividir el contenido por páginas usando la etiqueta <!-- PAGE X -->
    const pageSplits = textContent.split(/<!-- PAGE \d+ -->/);
    const pageMatches = [...textContent.matchAll(/<!-- PAGE (\d+) -->/g)].map(m => m[1]);

    const pageMatchesInt = pageMatches.map(m => parseInt(m, 10));
    let currentContainerIdx = currentPage - 1;
    if (pageMatchesInt.length > 0) {
      const matchIdx = pageMatchesInt.indexOf(currentPage);
      if (matchIdx !== -1) {
        currentContainerIdx = matchIdx + 1;
      } else if (currentPage < pageMatchesInt[0]) {
        currentContainerIdx = 0;
      }
    }

    return pageSplits.map((pageText, pIdx) => {
        const pageNum = pageMatches[pIdx - 1] || null; // El primer split está antes de la primera etiqueta
        const paragraphs = pageText.split('\n\n').filter(p => p.trim() !== '');

        if (paragraphs.length === 0) return null;

        const isNear = Math.abs(pIdx - currentContainerIdx) <= 1;
        
        if (!isNear) {
            const savedHeight = pageHeightsRef.current[pIdx];
            const estimatedHeight = savedHeight || Math.max(600, pageText.length * 0.75);
            return (
                <div 
                    key={pIdx} 
                    data-page-container 
                    data-page-idx={pIdx}
                    data-is-placeholder="true"
                    style={{ 
                        height: `${estimatedHeight}px`, 
                        marginBottom: '40px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'center',
                        background: 'transparent',
                        border: '1px dashed rgba(255, 255, 255, 0.02)',
                        borderRadius: '12px',
                        color: theme.textSecondary,
                        fontSize: '0.8rem',
                        opacity: 0.3,
                        userSelect: 'none',
                        pointerEvents: 'none'
                    }}
                >
                    {pageNum && <span>Page {pageNum}</span>}
                </div>
            );
        }

        return (
            <div key={pIdx} data-page-container data-page-idx={pIdx} style={{ marginBottom: '40px' }}>
                {pageNum && (
                    <div style={{ 
                        display: 'flex', alignItems: 'center', gap: '15px', 
                        margin: '50px 0 30px 0', opacity: 0.35, pointerEvents: 'none' 
                    }}>
                        <div style={{ flex: 1, height: '1px', background: theme.border }} />
                        <span style={{ fontSize: '0.75rem', letterSpacing: '2px', fontWeight: '700', textTransform: 'uppercase', color: theme.textSecondary }}>
                            Page {pageNum}
                        </span>
                        <div style={{ flex: 1, height: '1px', background: theme.border }} />
                    </div>
                )}

                {paragraphs.map((paragraph, index) => {
                    const paragraphKey = `${pIdx}_${index}`;
                    let flatIdx = 0;
                    
                    // Match legacy multi-word phrase highlights in this active paragraph only
                    const paragraphWords = paragraph.split(' ');
                    const cleanParagraphWords = paragraphWords.map(w => 
                        w.replace(/^[^\p{L}\p{N}]+/u, "")
                         .replace(/[^\p{L}\p{N}]+$/u, "")
                         .toLowerCase()
                    );
                    
                    const phraseHighlightedIndices = new Set();
                    legacyGlobalPhraseHighlights.forEach(phrase => {
                        const phraseCleanWords = phrase.split(' ');
                        const phraseLen = phraseCleanWords.length;
                        if (phraseLen === 0) return;
                        
                        for (let i = 0; i <= cleanParagraphWords.length - phraseLen; i++) {
                            let match = true;
                            for (let j = 0; j < phraseLen; j++) {
                                if (cleanParagraphWords[i + j] !== phraseCleanWords[j]) {
                                    match = false;
                                    break;
                                }
                            }
                            if (match) {
                                for (let j = 0; j < phraseLen; j++) {
                                    phraseHighlightedIndices.add(i + j);
                                }
                            }
                        }
                    });
                    
                    return (
                        <p key={index} style={{ 
        fontSize: '1.25rem', lineHeight: '1.9', 
                            fontFamily: '"New York", "Georgia", serif', textAlign: 'justify', 
                            color: theme.text, marginBottom: '24px', letterSpacing: '0.2px' 
                        }}>
                            {paragraphWords.map((word, wIdx) => {
                                // Helper to render a single clickable word span
                                const renderSingleWordSpan = (singleWord, uniqueId, currentFlatIdx) => {
                                    const match = singleWord.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?)([^\p{L}\p{N}]*)$/u);
                                    if (!match) {
                                        return <span key={uniqueId}>{singleWord}</span>;
                                    }
                                    
                                    const prefix = match[1];
                                    const core = match[2];
                                    const suffix = match[3];
                                    const clean = core.toLowerCase();

                                    const isSingleWordHighlighted = singleWordHighlights.includes(clean);
                                    
                                    // Check precise paragraph-confined phrase highlights
                                    const activePhraseForWord = paragraphPhraseHighlights.find(h => 
                                        h.pKey === paragraphKey && 
                                        currentFlatIdx >= h.startIdx && 
                                        currentFlatIdx <= h.endIdx
                                    );
                                    
                                    // Check legacy global phrase highlights
                                    const isLegacyPhraseHighlighted = phraseHighlightedIndices.has(wIdx);
                                    
                                    const isHard = isSingleWordHighlighted || !!activePhraseForWord || isLegacyPhraseHighlighted || ((currentDoc.id === 'demo') && dataLocal.analysis.vocabulary.some(v => v.word.toLowerCase() === clean));
                                    
                                    const onStart = (e) => {
                                        if (e.type === 'mousedown' && e.button !== 0) return;
                                        
                                        const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
                                        const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
                                        
                                        // Reset scroll-abort flag on every new touch
                                        touchScrollAborted.current = false;
                                        touchStartY.current = clientY;

                                        dragStartCoords.current = { x: clientX, y: clientY };
                                        isSelectingRange.current = true;
                                        isDraggingSelection.current = false;
                                        dragStartFlatIdx.current = currentFlatIdx;
                                        dragParagraphKey.current = paragraphKey;
                                        dragParagraphText.current = paragraph;
                                        activeSingleWord.current = core;
                                        draggedWordsRef.current = [];
                                        
                                        isLongPress.current = false;
                                        lastProcessedIdx.current = null;
                                        longPressTimer.current = setTimeout(() => {
                                            isLongPress.current = true;
                                            handleWordLongPress(core, paragraph);
                                        }, 650); // 650ms highly responsive, deliberate long-press
                                    };

                                    return (
                                        <React.Fragment key={uniqueId}>
                                            {prefix}
                                            <span 
                                                onMouseDown={onStart}
                                                onTouchStart={onStart}
                                                onContextMenu={(e) => e.preventDefault()}
                                                data-word-flat-idx={currentFlatIdx}
                                                data-word-clean={clean}
                                                data-word-raw={core}
                                                data-paragraph-key={paragraphKey}
                                                data-is-highlighted={isHard ? 'true' : undefined}
                                                style={{ 
                                                    display: 'inline', cursor: 'pointer', 
                                                    backgroundColor: isHard ? theme.highlightBg : 'transparent', 
                                                    color: isHard ? theme.highlightText : 'inherit',
                                                    borderBottom: isHard ? `1.5px solid ${theme.highlightBorder}` : 'none',
                                                    fontWeight: '400',
                                                    padding: '0',
                                                    transition: 'all 0.15s',
                                                    userSelect: 'none',
                                                    WebkitUserSelect: 'none'
                                                }}
                                                onMouseOver={(e) => { if(!isHard) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'; }}
                                                onMouseOut={(e) => { if(!isHard) e.currentTarget.style.backgroundColor = 'transparent'; }}
                                            >
                                                {core}
                                            </span>
                                            {suffix}
                                        </React.Fragment>
                                    );
                                };

                                // Check if the word contains a hyphen, en-dash, or em-dash (e.g. card—two) and split if necessary
                                const dashMatch = word.match(/[-–—]/);
                                const hasDash = dashMatch && 
                                    word !== '-' && word !== '–' && word !== '—' && 
                                    !word.startsWith('-') && !word.endsWith('-') && 
                                    !word.startsWith('–') && !word.endsWith('–') && 
                                    !word.startsWith('—') && !word.endsWith('—');
                                
                                if (hasDash) {
                                    const dashChar = dashMatch[0];
                                    const subWords = word.split(dashChar);
                                    const renderedSubWords = subWords.map((subWord, subIdx) => {
                                        const isLast = subIdx === subWords.length - 1;
                                        const currentFlatIdx = flatIdx++;
                                        return (
                                            <React.Fragment key={subIdx}>
                                                {renderSingleWordSpan(subWord, `${wIdx}_${subIdx}`, currentFlatIdx)}
                                                {!isLast && <span style={{ color: theme.text, opacity: 0.8, pointerEvents: 'none' }}>{dashChar}</span>}
                                            </React.Fragment>
                                        );
                                    });
                                    
                                    const lastFlatIdx = flatIdx - 1;
                                    const activePhraseForWord = paragraphPhraseHighlights.find(h => 
                                        h.pKey === paragraphKey && 
                                        lastFlatIdx >= h.startIdx && 
                                        lastFlatIdx <= h.endIdx
                                    );
                                    const isLegacyPhraseHighlighted = phraseHighlightedIndices.has(wIdx);
                                    
                                    let isSpacerHighlighted = false;
                                    if (activePhraseForWord) {
                                        isSpacerHighlighted = lastFlatIdx + 1 <= activePhraseForWord.endIdx;
                                    } else if (isLegacyPhraseHighlighted) {
                                        isSpacerHighlighted = phraseHighlightedIndices.has(wIdx + 1);
                                    }
                                    
                                    return (
                                        <span key={wIdx} style={{ display: 'inline' }}>
                                            {renderedSubWords}
                                            {wIdx < paragraphWords.length - 1 && (
                                                <span 
                                                    data-space-after-idx={lastFlatIdx}
                                                    data-paragraph-key={paragraphKey}
                                                    data-is-highlighted={isSpacerHighlighted ? 'true' : undefined}
                                                    style={{
                                                        display: 'inline',
                                                        backgroundColor: isSpacerHighlighted ? 'rgba(255, 179, 64, 0.2)' : 'transparent',
                                                        borderBottom: isSpacerHighlighted ? `1.5px solid ${theme.highlightBorder}` : 'none',
                                                        userSelect: 'none',
                                                        WebkitUserSelect: 'none'
                                                    }}
                                                >
                                                    {' '}
                                                </span>
                                            )}
                                        </span>
                                    );
                                } else {
                                    const currentFlatIdx = flatIdx++;
                                    const activePhraseForWord = paragraphPhraseHighlights.find(h => 
                                        h.pKey === paragraphKey && 
                                        currentFlatIdx >= h.startIdx && 
                                        currentFlatIdx <= h.endIdx
                                    );
                                    const isLegacyPhraseHighlighted = phraseHighlightedIndices.has(wIdx);
                                    
                                    let isSpacerHighlighted = false;
                                    if (activePhraseForWord) {
                                        isSpacerHighlighted = currentFlatIdx + 1 <= activePhraseForWord.endIdx;
                                    } else if (isLegacyPhraseHighlighted) {
                                        isSpacerHighlighted = phraseHighlightedIndices.has(wIdx + 1);
                                    }
                                    
                                    return (
                                        <React.Fragment key={wIdx}>
                                            {renderSingleWordSpan(word, `${wIdx}_main`, currentFlatIdx)}
                                            {wIdx < paragraphWords.length - 1 && (
                                                <span 
                                                    data-space-after-idx={currentFlatIdx}
                                                    data-paragraph-key={paragraphKey}
                                                    data-is-highlighted={isSpacerHighlighted ? 'true' : undefined}
                                                    style={{
                                                        display: 'inline',
                                                        backgroundColor: isSpacerHighlighted ? 'rgba(255, 179, 64, 0.2)' : 'transparent',
                                                        borderBottom: isSpacerHighlighted ? `1.5px solid ${theme.highlightBorder}` : 'none',
                                                        userSelect: 'none',
                                                        WebkitUserSelect: 'none'
                                                    }}
                                                >
                                                    {' '}
                                                </span>
                                            )}
                                        </React.Fragment>
                                    );
                                }
                            })}
                        </p>
                    );
                })}
            </div>
        );
    });
  }, [currentDoc, currentPage, theme.highlightBg, theme.highlightText, theme.highlightBorder, handleWordClick, handleWordLongPress]);

  const renderDocItem = (doc, isInsideFolder = false) => {
    const isSelected = currentDoc?.id === doc.id;
    const cleanDocTitle = doc.title.startsWith("Subrayados: ") ? doc.title.replace("Subrayados: ", "") : doc.title;
    return (
      <div 
        key={doc.id} 
        onClick={() => { 
          setCurrentDoc(doc); 
          setSidebarOpen(false); 
          const matchedAudio = findAudioForDoc(doc, documents);
          if (matchedAudio) {
            setActiveAudio(matchedAudio);
          } else {
            setActiveAudio(null);
            setIsPlaying(false);
            if (audioRef.current) audioRef.current.pause();
          }
        }} 
        style={{ 
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '8px 10px', borderRadius: '10px', cursor: 'pointer', 
          background: isSelected ? 'rgba(10, 132, 255, 0.12)' : 'transparent',
          color: isSelected ? '#0A84FF' : theme.text,
          transition: 'all 0.15s', fontSize: '0.88rem', fontWeight: isSelected ? '600' : '400'
        }}
        onMouseOver={(e) => { if(!isSelected) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)'; }}
        onMouseOut={(e) => { if(!isSelected) e.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        <BookIcon />
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {cleanDocTitle}
          </span>
          {!isInsideFolder && docFolders[doc.id] && (
            <span style={{ fontSize: '0.68rem', background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px', color: theme.textSecondary, whiteSpace: 'nowrap' }}>
              📁 {docFolders[doc.id]}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }} onClick={e => e.stopPropagation()}>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setEditModalDoc(doc);
              setEditDocTitle(cleanDocTitle);
              setEditDocContent(doc.content || "");
              setEditDocLang(doc.language || "fr");
              setEditDocAudioFile(null);
            }}
            className="icon-btn"
            title="Edit document"
            style={{ padding: '4px', opacity: 0.5 }}
            onMouseOver={e => e.currentTarget.style.opacity = 1}
            onMouseOut={e => e.currentTarget.style.opacity = 0.5}
          >
            <EditIcon />
          </button>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setMoveModalDoc(doc);
            }}
            className="icon-btn"
            title="Move to folder"
            style={{ padding: '4px', opacity: 0.5 }}
            onMouseOver={e => e.currentTarget.style.opacity = 1}
            onMouseOut={e => e.currentTarget.style.opacity = 0.5}
          >
            <FolderIconSmall />
          </button>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteDocument(doc);
            }}
            className="icon-btn"
            title="Delete permanently"
            style={{ padding: '4px', opacity: 0.5, color: '#FF453A' }}
            onMouseOver={e => e.currentTarget.style.opacity = 1}
            onMouseOut={e => e.currentTarget.style.opacity = 0.5}
          >
            <TrashIcon />
          </button>
        </div>
      </div>
    );
  };

  const renderAudioItem = (doc, isInsideFolder = false, customLabel = null) => {
    const isActive = activeAudio?.url === doc.audio_url;
    return (
      <div 
        key={doc.id} 
        onClick={() => {
          setActiveAudio({ url: doc.audio_url, title: doc.title });
          setSidebarOpen(false);
        }}
        style={{ 
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '8px 10px', borderRadius: '10px', cursor: 'pointer', 
          background: isActive ? 'rgba(48, 209, 88, 0.12)' : 'transparent',
          color: isActive ? '#30D158' : theme.text,
          transition: 'all 0.15s', fontSize: '0.88rem', fontWeight: isActive ? '600' : '400'
        }}
        onMouseOver={(e) => { if(!isActive) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)'; }}
        onMouseOut={(e) => { if(!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        <AudioIcon />
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {customLabel || doc.title}
          </span>
          {!isInsideFolder && docFolders[doc.id] && (
            <span style={{ fontSize: '0.68rem', background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '4px', color: theme.textSecondary, whiteSpace: 'nowrap' }}>
              📁 {docFolders[doc.id]}
            </span>
          )}
          {isActive && (
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#30D158', display: 'inline-block', flexShrink: 0 }} />
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }} onClick={e => e.stopPropagation()}>
          {downloadProgress[doc.audio_url] !== undefined ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', color: '#0A84FF', fontWeight: '700' }}>
              <span>{downloadProgress[doc.audio_url]}%</span>
              <SpinnerIcon />
            </div>
          ) : cachedUrls[doc.audio_url] ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
              <CheckIcon />
              <button 
                onClick={(e) => handleDeleteCache(doc.audio_url, e)} 
                className="icon-btn" 
                style={{ padding: '4px', opacity: 0.4 }}
                title="Remove offline download"
                onMouseOver={(e) => e.currentTarget.style.opacity = 1}
                onMouseOut={(e) => e.currentTarget.style.opacity = 0.4}
              >
                <DeleteTrashIcon />
              </button>
            </div>
          ) : (
            <button 
              onClick={(e) => downloadAudio(doc.audio_url, e)} 
              className="icon-btn" 
              style={{ padding: '4px', opacity: 0.4 }}
              title="Download for offline listening"
              onMouseOver={(e) => e.currentTarget.style.opacity = 1}
              onMouseOut={(e) => e.currentTarget.style.opacity = 0.4}
            >
              <DownloadIcon />
            </button>
          )}

          <button 
            onClick={(e) => {
              e.stopPropagation();
              setEditModalDoc(doc);
              setEditDocTitle(doc.title);
              setEditDocContent(doc.content || "");
              setEditDocLang(doc.language || "audio");
              setEditDocAudioFile(null);
            }}
            className="icon-btn"
            title="Edit audio"
            style={{ padding: '4px', opacity: 0.5 }}
            onMouseOver={e => e.currentTarget.style.opacity = 1}
            onMouseOut={e => e.currentTarget.style.opacity = 0.5}
          >
            <EditIcon />
          </button>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setMoveModalDoc(doc);
            }}
            className="icon-btn"
            title="Move to folder"
            style={{ padding: '4px', opacity: 0.5 }}
            onMouseOver={e => e.currentTarget.style.opacity = 1}
            onMouseOut={e => e.currentTarget.style.opacity = 0.5}
          >
            <FolderIconSmall />
          </button>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteDocument(doc);
            }}
            className="icon-btn"
            title="Delete permanently"
            style={{ padding: '4px', opacity: 0.5, color: '#FF453A' }}
            onMouseOver={e => e.currentTarget.style.opacity = 1}
            onMouseOut={e => e.currentTarget.style.opacity = 0.5}
          >
            <TrashIcon />
          </button>
        </div>
      </div>
    );
  };

  const renderAudioGroup = (group, isInsideFolder = false) => {
    if (group.tracks.length === 1) {
      return renderAudioItem(group.tracks[0], isInsideFolder);
    }

    const isGroupOpen = openAudioGroups[group.series] ?? (
      activeAudio && group.tracks.some(t => t.audio_url === activeAudio.url)
    );
    const activeTrackInGroup = activeAudio && group.tracks.find(t => t.audio_url === activeAudio.url);

    return (
      <div key={group.series} style={{ display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', padding: '4px', border: '1px solid rgba(255,255,255,0.04)', marginBottom: '4px' }}>
        <div 
          style={{ 
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
            padding: '8px 10px', cursor: 'pointer', borderRadius: '8px', transition: 'background 0.15s'
          }}
          onClick={() => setOpenAudioGroups(prev => ({ ...prev, [group.series]: !isGroupOpen }))}
          onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)'}
          onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: '1rem' }}>🎧</span>
            <span style={{ fontWeight: '600', fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, color: activeTrackInGroup ? '#30D158' : 'white' }}>
              {group.series}
            </span>
            <span style={{ fontSize: '0.72rem', background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '6px', color: theme.textSecondary, whiteSpace: 'nowrap' }}>
              {group.tracks.length} chapters
            </span>
            {activeTrackInGroup && (
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#30D158', display: 'inline-block', flexShrink: 0 }} />
            )}
            <ChevronIcon isOpen={isGroupOpen} />
          </div>
        </div>

        {isGroupOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '2px 4px 4px 8px', borderLeft: '2px solid rgba(255,255,255,0.08)', marginLeft: '12px', marginTop: '2px' }}>
            {group.tracks.map(trackDoc => renderAudioItem(trackDoc, isInsideFolder, trackDoc.trackLabel))}
          </div>
        )}
      </div>
    );
  };

  const renderFolderSelector = () => (
    <div style={{ marginBottom: '16px' }}>
      <label style={{ display: 'block', fontSize: '0.8rem', color: theme.textSecondary, marginBottom: '6px', fontWeight: '700', letterSpacing: '0.5px' }}>
        FOLDER / COLLECTION (OPTIONAL)
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ position: 'relative', width: '100%' }}>
          <select 
            value={selectedFolder}
            onChange={e => {
              if (e.target.value === '__new__') {
                setIsCreatingFolder(true);
              } else {
                setSelectedFolder(e.target.value);
              }
            }}
            style={{ 
              appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
              width: '100%', padding: '14px 40px 14px 14px', background: '#2C2C2E', border: 'none', 
              borderRadius: '12px', color: 'white', fontSize: '0.95rem', outline: 'none', cursor: 'pointer' 
            }}
          >
            <option value="">No folder (General)</option>
            {folders.map(f => (
              <option key={f} value={f}>📁 {f}</option>
            ))}
            <option value="__new__">+ Create new folder...</option>
          </select>
          <div style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', opacity: 0.6 }}>
            <ChevronIcon isOpen={false} />
          </div>
        </div>

        {isCreatingFolder && (
          <div style={{ display: 'flex', gap: '6px', width: '100%', marginTop: '4px' }}>
            <input 
              type="text" 
              placeholder="New folder name" 
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              style={{ flex: 1, padding: '12px', background: '#3A3A3C', border: 'none', borderRadius: '10px', color: 'white', fontSize: '0.9rem', outline: 'none' }}
            />
            <button 
              type="button"
              onClick={() => {
                const trimmed = newFolderName.trim();
                if (trimmed) {
                  createFolder(trimmed);
                  setSelectedFolder(trimmed);
                }
                setNewFolderName('');
                setIsCreatingFolder(false);
              }}
              style={{ padding: '0 14px', background: theme.accent, border: 'none', borderRadius: '10px', color: 'white', fontWeight: '600', cursor: 'pointer' }}
            >
              Add
            </button>
            <button 
              type="button"
              onClick={() => { setIsCreatingFolder(false); setNewFolderName(''); }}
              style={{ padding: '0 12px', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '10px', color: '#aaa', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ backgroundColor: theme.bg, minHeight: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, Roboto, sans-serif', color: theme.text, paddingBottom: '220px' }}>
      
      {/* HEADER */}
      <header style={{ 
          position: 'sticky', top: 0, zIndex: 50, backgroundColor: theme.headerBg, 
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          padding: '15px 20px', borderBottom: `1px solid ${theme.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' 
      }}>
         <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
             <button onClick={() => setSidebarOpen(true)} className="icon-btn"><MenuIcon/></button>
             <h1 style={{ fontSize: '0.9rem', margin: 0, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px', color: theme.textSecondary }}>
               {currentDoc ? (currentDoc.title.length > 25 ? currentDoc.title.substring(0,25)+'...' : currentDoc.title) : 'Linguini'}
             </h1>
         </div>
         <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
             <button 
                 onClick={() => {
                     if (!isOnline) {
                         showToast("No internet connection.");
                     } else {
                         setIsManualOffline(prev => !prev);
                         showToast(!isManualOffline ? "Manual offline mode enabled." : "Connected to Internet.");
                     }
                 }} 
                 style={{ 
                     display: 'flex', 
                     alignItems: 'center', 
                     gap: '5px', 
                     fontSize: '0.8rem', 
                     fontWeight: '600', 
                     padding: '6px 12px', 
                     borderRadius: '20px',
                     border: '1px solid',
                     cursor: 'pointer',
                     transition: 'all 0.2s',
                     outline: 'none',
                     backgroundColor: !isOnline 
                         ? 'rgba(255, 69, 58, 0.1)' 
                         : isManualOffline 
                             ? 'rgba(255, 159, 10, 0.15)' 
                             : 'rgba(48, 209, 88, 0.1)',
                     color: !isOnline 
                         ? '#FF453A' 
                         : isManualOffline 
                             ? '#FF9F0A' 
                             : '#30D158',
                     borderColor: !isOnline 
                         ? 'rgba(255, 69, 58, 0.2)' 
                         : isManualOffline 
                             ? 'rgba(255, 159, 10, 0.3)' 
                             : 'rgba(48, 209, 88, 0.2)',
                 }}
                 title={!isOnline ? "No internet connection (Automatic offline mode)" : isManualOffline ? "Manual offline mode (Click to go online)" : "Connected to internet (Click to go offline)"}
             >
                 <span>{!isOnline ? '📴' : isManualOffline ? '📴' : '📶'}</span>
                 <span>{!isOnline ? 'Offline' : isManualOffline ? 'Offline' : 'Online'}</span>
             </button>
             {currentDoc && currentDoc.id !== 'demo' && (
                 <button 
                     onClick={() => setShowBookmarkModal(true)} 
                     className="icon-btn" 
                     style={{ 
                         color: '#FF9F0A', 
                         display: 'flex', 
                         alignItems: 'center', 
                         gap: '6px', 
                         fontSize: '0.85rem', 
                         fontWeight: '600', 
                         background: 'rgba(255, 159, 10, 0.1)', 
                         padding: '6px 12px', 
                         borderRadius: '20px',
                         border: '1px solid rgba(255, 159, 10, 0.2)'
                     }}
                     title="Bookmark (Save Position)"
                 >
                     <span>🔖</span>
                     <span style={{ display: 'inline' }}>Bookmark</span>
                 </button>
             )}
             <button onClick={() => {
                 const now = new Date();
                 setNewTitle(`Note ${now.getDate()}/${now.getMonth()+1} ${now.getHours()}:${now.getMinutes()}`);
                 setNewContent("");
                 setShowAddModal(true);
             }} className="icon-btn" style={{ color: theme.accent }}><PlusIcon/></button>
         </div>
      </header>

      {/* SIDEBAR */}
      <div style={{ 
          position: 'fixed', top: 0, left: 0, bottom: 0, width: '290px', 
          background: '#141414',
          zIndex: 3000, transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)', 
          willChange: 'transform',
          transition: 'transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)', borderRight: `1px solid ${theme.border}`, 
          display: 'flex', flexDirection: 'column', padding: '20px'
      }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px', paddingLeft: '8px' }}>
              <h2 style={{ fontSize: '1.35rem', margin: 0, fontWeight: '700', letterSpacing: '-0.5px' }}>Library</h2>
              <button onClick={() => setSidebarOpen(false)} className="icon-btn" style={{ opacity: 0.7 }}><CloseIconSimple/></button>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto', flex: 1, padding: '4px 4px 16px 2px' }}>
              
              {/* BOTÓN VOCABULARY LIST */}
              <div 
                  onClick={() => {
                      setSidebarOpen(false);
                      setShowVocabModal(true);
                  }}
                  style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '12px 14px', borderRadius: '12px',
                      background: 'linear-gradient(135deg, rgba(255, 179, 64, 0.15) 0%, rgba(255, 149, 0, 0.05) 100%)',
                      border: '1px solid rgba(255, 179, 64, 0.25)',
                      cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      flexShrink: 0
                  }}
                  onMouseOver={(e) => {
                      e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255, 179, 64, 0.25) 0%, rgba(255, 149, 0, 0.12) 100%)';
                      e.currentTarget.style.borderColor = 'rgba(255, 179, 64, 0.45)';
                      e.currentTarget.style.boxShadow = '0 6px 16px rgba(255, 179, 64, 0.15)';
                  }}
                  onMouseOut={(e) => {
                      e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255, 179, 64, 0.15) 0%, rgba(255, 149, 0, 0.05) 100%)';
                      e.currentTarget.style.borderColor = 'rgba(255, 179, 64, 0.25)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                  }}
              >
                  <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: '32px', height: '32px', borderRadius: '8px',
                      background: '#FF9500', color: '#000'
                  }}>
                      <VocabIcon />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '0.9rem', fontWeight: '700', color: '#fff', letterSpacing: '-0.2px' }}>
                          Vocabulary
                      </span>
                      <span style={{ fontSize: '0.72rem', color: '#FFB340', opacity: 0.9 }}>
                          Saved Words & Translations
                      </span>
                  </div>
              </div>

              <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '2px 0' }} />

              {/* SECCIÓN CARPETAS / COLECCIONES */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div 
                      style={{ 
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                          padding: '10px 8px', borderRadius: '8px', userSelect: 'none', transition: 'background 0.2s'
                      }}
                      onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)'}
                      onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                      <div 
                          onClick={() => setSidebarSections(prev => ({ ...prev, folders: !prev.folders }))}
                          style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', flex: 1 }}
                      >
                          <span style={{ fontSize: '0.8rem', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', color: theme.textSecondary }}>
                              Folders ({folders.length})
                          </span>
                          <ChevronIcon isOpen={sidebarSections.folders} />
                      </div>
                      <button 
                          onClick={(e) => {
                              e.stopPropagation();
                              const name = prompt("Name for the new folder / collection (e.g. 'French Podcast', 'Neuroscience Study'):");
                              if (name && name.trim()) {
                                  createFolder(name.trim());
                              }
                          }}
                          style={{ 
                              background: 'rgba(10, 132, 255, 0.15)', border: 'none', borderRadius: '6px', 
                              color: '#0A84FF', fontSize: '0.75rem', fontWeight: '700', padding: '4px 8px', cursor: 'pointer' 
                          }}
                      >
                          + New
                      </button>
                  </div>

                  {sidebarSections.folders && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: '4px', marginTop: '2px' }}>
                          {folders.map(folderName => {
                              const folderBooks = cloudBooks.filter(d => docFolders[d.id] === folderName);
                              const folderAudios = cloudAudiobooks.filter(d => docFolders[d.id] === folderName);
                              const totalCount = folderBooks.length + folderAudios.length;
                              const isFolderOpen = openFolders[folderName] !== false;

                              return (
                                  <div key={folderName} style={{ display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', padding: '4px', border: '1px solid rgba(255,255,255,0.04)' }}>
                                      <div 
                                          style={{ 
                                              display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                                              padding: '8px 10px', cursor: 'pointer', borderRadius: '8px', transition: 'background 0.15s'
                                          }}
                                          onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)'}
                                          onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                      >
                                          <div 
                                              onClick={() => setOpenFolders(prev => ({ ...prev, [folderName]: !isFolderOpen }))}
                                              style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}
                                          >
                                              <span style={{ fontSize: '1rem' }}>📁</span>
                                              <span style={{ fontWeight: '600', fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                                  {folderName}
                                              </span>
                                              <span style={{ fontSize: '0.72rem', background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: '6px', color: theme.textSecondary }}>
                                                  {totalCount}
                                              </span>
                                              <ChevronIcon isOpen={isFolderOpen} />
                                          </div>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginLeft: '6px' }} onClick={e => e.stopPropagation()}>
                                              <button 
                                                  onClick={() => renameFolder(folderName)} 
                                                  className="icon-btn" 
                                                  title="Rename folder"
                                                  style={{ padding: '4px', opacity: 0.5 }}
                                                  onMouseOver={e => e.currentTarget.style.opacity = 1}
                                                  onMouseOut={e => e.currentTarget.style.opacity = 0.5}
                                              >
                                                  <EditIcon />
                                              </button>
                                              <button 
                                                  onClick={() => deleteFolder(folderName)} 
                                                  className="icon-btn" 
                                                  title="Delete folder"
                                                  style={{ padding: '4px', opacity: 0.5, color: '#FF453A' }}
                                                  onMouseOver={e => e.currentTarget.style.opacity = 1}
                                                  onMouseOut={e => e.currentTarget.style.opacity = 0.5}
                                              >
                                                  <TrashIcon />
                                              </button>
                                          </div>
                                      </div>

                                      {/* Contenido dentro de la carpeta */}
                                      {isFolderOpen && (
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', padding: '4px 6px 6px 10px' }}>
                                              {folderBooks.map(doc => renderDocItem(doc, true))}
                                              {groupAudiobooks(folderAudios).map(group => renderAudioGroup(group, true))}
                                              {totalCount === 0 && (
                                                  <div style={{ padding: '8px', fontSize: '0.8rem', color: theme.textSecondary, fontStyle: 'italic', textAlign: 'center' }}>
                                                      Empty folder
                                                  </div>
                                              )}
                                          </div>
                                      )}
                                  </div>
                              );
                          })}

                          {folders.length === 0 && (
                              <div style={{ padding: '8px 12px', fontSize: '0.82rem', color: theme.textSecondary, fontStyle: 'italic', textAlign: 'center' }}>
                                  Create folders with "+ New" to organize your audios and books
                              </div>
                          )}
                      </div>
                  )}
              </div>
              
              <div style={{ height: '1px', background: theme.border, margin: '5px 0' }} />

              {/* SECCIÓN LIBROS / BOOKS */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div 
                      onClick={() => setSidebarSections(prev => ({ ...prev, books: !prev.books }))}
                      style={{ 
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                          padding: '10px 8px', cursor: 'pointer', borderRadius: '8px', 
                          userSelect: 'none', transition: 'background 0.2s'
                      }}
                      onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)'}
                      onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                      <span style={{ fontSize: '0.8rem', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', color: theme.textSecondary }}>
                          All Books ({cloudBooks.length})
                      </span>
                      <ChevronIcon isOpen={sidebarSections.books} />
                  </div>
                  
                  {sidebarSections.books && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '4px', marginTop: '2px' }}>
                          {cloudBooks.map(doc => renderDocItem(doc, false))}
                          
                          {cloudBooks.length === 0 && (
                              <div style={{ padding: '12px', fontSize: '0.85rem', color: theme.textSecondary, fontStyle: 'italic', textAlign: 'center' }}>
                                  Import your first PDF with the + button
                              </div>
                          )}
                      </div>
                  )}
              </div>
              
              <div style={{ height: '1px', background: theme.border, margin: '5px 0' }} />
              
              {/* SECCIÓN AUDIO / AUDIOBOOKS */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div 
                      onClick={() => setSidebarSections(prev => ({ ...prev, audios: !prev.audios }))}
                      style={{ 
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                          padding: '10px 8px', cursor: 'pointer', borderRadius: '8px', 
                          userSelect: 'none', transition: 'background 0.2s'
                      }}
                      onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)'}
                      onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                      <span style={{ fontSize: '0.8rem', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', color: theme.textSecondary }}>
                          All Audiobooks ({cloudAudiobooks.length})
                      </span>
                      <ChevronIcon isOpen={sidebarSections.audios} />
                  </div>
                  
                  {sidebarSections.audios && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '4px', marginTop: '2px' }}>
                          {groupAudiobooks(cloudAudiobooks).map(group => renderAudioGroup(group, false))}
                          
                          {cloudAudiobooks.length === 0 && (
                              <div style={{ padding: '12px', fontSize: '0.85rem', color: theme.textSecondary, fontStyle: 'italic', textAlign: 'center' }}>
                                  Upload an audiobook with the + button
                              </div>
                          )}
                      </div>
                  )}
              </div>
              
          </div>

          <div style={{ height: '1px', background: theme.border, margin: '15px 0 10px 0' }} />
          
          <div style={{ 
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
              padding: '12px 14px', borderRadius: '14px', background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.04)'
          }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'left' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: '600', color: '#fff' }}>Detailed Mode</span>
                  <span style={{ fontSize: '0.65rem', color: theme.textSecondary }}>Explanations & Examples</span>
              </div>
              <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '42px', height: '24px', cursor: 'pointer' }}>
                  <input 
                      type="checkbox" 
                      checked={isDetailedMode}
                      onChange={(e) => setIsDetailedMode(e.target.checked)}
                      style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span className="slider" style={{
                      position: 'absolute', inset: 0,
                      backgroundColor: isDetailedMode ? '#30D158' : 'rgba(255,255,255,0.15)',
                      transition: '0.2s', borderRadius: '34px'
                  }}>
                      <span style={{
                          position: 'absolute', height: '18px', width: '18px',
                          left: isDetailedMode ? '20px' : '4px', bottom: '3px',
                          backgroundColor: 'white', transition: '0.2s', borderRadius: '50%'
                      }} />
                  </span>
              </label>
          </div>
      </div>
      {sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2999, backdropFilter: 'blur(2px)' }} />}

      {/* TEXTO PRINCIPAL */}
      <div className="responsive-container" style={{ margin: '0 auto', padding: '30px 24px', maxWidth: '800px' }}>
        {memoizedBookContent}
      </div>

      {/* REPRODUCTOR FLOTANTE DESACOPLADO */}
      {activeAudio && (
        <div style={{
            position: 'fixed', bottom: '30px', left: '20px', right: '20px', maxWidth: '480px', margin: '0 auto',
            backgroundColor: 'rgba(28, 28, 30, 0.8)', backdropFilter: 'blur(25px)', WebkitBackdropFilter: 'blur(25px)',
            borderRadius: '20px', padding: '20px 24px', zIndex: 1000, color: 'white',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <div style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '15px', flex: 1 }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: '600', letterSpacing: '0.3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {activeAudio.title.startsWith("Subrayados: ") ? activeAudio.title.replace("Subrayados: ", "") : activeAudio.title}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#86868b' }}>
                        {currentTrackGroup && currentTrackGroup.currentIndex !== -1
                            ? `${currentTrackGroup.series} · Chapter ${currentTrackGroup.currentIndex + 1} of ${currentTrackGroup.tracks.length}`
                            : 'Playing Audio'}
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <select 
                        value={playbackRate} 
                        onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
                        style={{ 
                            appearance: 'none',
                            WebkitAppearance: 'none',
                            MozAppearance: 'none',
                            background: 'rgba(255,255,255,0.08)',
                            border: 'none',
                            borderRadius: '8px',
                            color: '#fff',
                            fontSize: '0.75rem',
                            fontWeight: '600',
                            padding: '6px 12px',
                            outline: 'none',
                            cursor: 'pointer',
                            textAlign: 'center'
                        }}
                    >
                        <option value="0.25" style={{ background: '#1c1c1e' }}>0.25x</option>
                        <option value="0.5" style={{ background: '#1c1c1e' }}>0.5x</option>
                        <option value="0.75" style={{ background: '#1c1c1e' }}>0.75x</option>
                        <option value="1" style={{ background: '#1c1c1e' }}>1.0x</option>
                        <option value="1.25" style={{ background: '#1c1c1e' }}>1.25x</option>
                        <option value="1.5" style={{ background: '#1c1c1e' }}>1.5x</option>
                        <option value="1.75" style={{ background: '#1c1c1e' }}>1.75x</option>
                        <option value="2" style={{ background: '#1c1c1e' }}>2.0x</option>
                        <option value="2.25" style={{ background: '#1c1c1e' }}>2.25x</option>
                    </select>
                    <button 
                        onClick={() => {
                            setActiveAudio(null);
                            setIsPlaying(false);
                            if (audioRef.current) audioRef.current.pause();
                        }}
                        className="icon-btn"
                        title="Dismiss player"
                        style={{ padding: '6px', opacity: 0.6, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }}
                        onMouseOver={e => e.currentTarget.style.opacity = 1}
                        onMouseOut={e => e.currentTarget.style.opacity = 0.6}
                    >
                        <CloseIconSimple />
                    </button>
                </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.75rem', color: '#86868b', fontFamily: 'monospace' }}>
                    <span style={{ width: '35px', textAlign: 'right' }}>{formatTime(currentTime)}</span>
                    <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <input 
                            type="range" 
                            min="0" 
                            max={duration || 0} 
                            value={currentTime} 
                            onMouseDown={handleSeekStart}
                            onTouchStart={handleSeekStart}
                            onChange={handleSeek} 
                            onMouseUp={handleSeekEnd}
                            onTouchEnd={handleSeekEnd}
                            onMouseMove={handleProgressBarMouseMove}
                            onMouseLeave={handleProgressBarMouseLeave}
                            className="custom-range" 
                            style={{
                                background: `linear-gradient(to right, #FFD60A 0%, #FFD60A ${(currentTime / (duration || 1)) * 100}%, rgba(255,255,255,0.2) ${(currentTime / (duration || 1)) * 100}%, rgba(255,255,255,0.2) 100%)`
                            }}
                        />
                        {hoverTime !== null && (
                            <div style={{
                                position: 'absolute',
                                left: `${hoverX}px`,
                                bottom: '22px',
                                transform: 'translateX(-50%)',
                                backgroundColor: 'rgba(0, 0, 0, 0.95)',
                                color: '#fff',
                                fontSize: '0.7rem',
                                padding: '3px 6px',
                                borderRadius: '4px',
                                pointerEvents: 'none',
                                whiteSpace: 'nowrap',
                                zIndex: 2000,
                                border: '1px solid rgba(255,255,255,0.15)',
                                boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                                fontFamily: 'monospace'
                            }}>
                                {formatTime(hoverTime)}
                            </div>
                        )}
                    </div>
                    <span style={{ width: '35px' }}>{formatTime(duration)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: currentTrackGroup ? '18px' : '30px' }}>
                    {currentTrackGroup && (
                        <button 
                            onClick={handlePrevTrack} 
                            className="icon-btn-player" 
                            disabled={!currentTrackGroup.hasPrev}
                            style={{ opacity: currentTrackGroup.hasPrev ? 0.9 : 0.25, cursor: currentTrackGroup.hasPrev ? 'pointer' : 'default', padding: '4px' }}
                            title="Previous Chapter"
                        >
                            <PrevTrackIcon />
                        </button>
                    )}
                    <button onClick={() => skipTime(-10)} className="icon-btn-player" title="Rewind 10s"><BackIcon/></button>
                    <button onClick={togglePlay} className="icon-btn-player" style={{ transform: 'scale(1.2)' }}>{isPlaying ? <PauseIcon/> : <PlayIcon/>}</button>
                    <button onClick={() => skipTime(10)} className="icon-btn-player" title="Forward 10s"><ForwardIcon/></button>
                    {currentTrackGroup && (
                        <button 
                            onClick={handleNextTrack} 
                            className="icon-btn-player" 
                            disabled={!currentTrackGroup.hasNext}
                            style={{ opacity: currentTrackGroup.hasNext ? 0.9 : 0.25, cursor: currentTrackGroup.hasNext ? 'pointer' : 'default', padding: '4px' }}
                            title="Next Chapter"
                        >
                            <NextTrackIcon />
                        </button>
                    )}
                </div>
            </div>
            <audio ref={audioRef} onLoadedMetadata={handleAudioMetadataLoaded}>
              {audioSrc && <source src={audioSrc} type="audio/mpeg" />}
            </audio>
        </div>
      )}

      {/* TOAST TEMPORAL */}
      {toastMessage && (
        <div style={{
          position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
          backgroundColor: '#30D158', color: '#fff', padding: '12px 24px',
          borderRadius: '12px', zIndex: 9999, fontWeight: '600', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          animation: 'slideDown 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)', fontSize: '0.9rem'
        }}>
          {toastMessage}
        </div>
      )}

      {/* MODAL SEPARADOR DIGITAL (CONGELAR ESTADO) */}
      {showBookmarkModal && currentDoc && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: '#1C1C1E', width: '90%', maxWidth: '420px', padding: '30px', borderRadius: '24px', boxShadow: '0 25px 50px rgba(0,0,0,0.7)', border: `1px solid ${theme.border}` }}>
                <h3 style={{ marginTop: 0, color: 'white', marginBottom: '15px', fontSize: '1.3rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🔖</span> Bookmark Position
                </h3>
                <p style={{ color: theme.textSecondary, fontSize: '0.9rem', lineHeight: '1.4', marginBottom: '20px', textAlign: 'left' }}>
                  Save and synchronize your current reading position across devices?
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '16px', marginBottom: '24px', border: '1px solid rgba(255,255,255,0.05)', textAlign: 'left' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span style={{ color: theme.textSecondary }}>Book:</span>
                    <span style={{ color: 'white', fontWeight: '600', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentDoc.title}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span style={{ color: theme.textSecondary }}>Page:</span>
                    <span style={{ color: 'white', fontWeight: '600' }}>{currentPage}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span style={{ color: theme.textSecondary }}>Audio:</span>
                    <span style={{ color: 'white', fontWeight: '600', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {activeAudio && isAudioMatchingDoc(activeAudio, currentDoc) ? activeAudio.name || activeAudio.title : 'None'}
                    </span>
                  </div>
                  {activeAudio && isAudioMatchingDoc(activeAudio, currentDoc) && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                      <span style={{ color: theme.textSecondary }}>Audio Timestamp:</span>
                      <span style={{ color: 'white', fontWeight: '600' }}>
                        {(() => {
                          const t = getActiveAudioTimeForDoc();
                          const m = Math.floor(t / 60);
                          const s = Math.floor(t % 60);
                          return `${m}:${s < 10 ? '0' : ''}${s}`;
                        })()}
                      </span>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                    <button onClick={() => setShowBookmarkModal(false)} className="btn-secondary" style={{ padding: '10px 16px', fontSize: '0.9rem' }}>Cancel</button>
                    <button onClick={handleSaveBookmark} className="btn-primary" style={{ padding: '10px 20px', fontSize: '0.9rem', background: '#FF9F0A' }}>Save Position</button>
                </div>
            </div>
        </div>
      )}

      {/* MODAL AGREGAR TEXTO */}
      {showAddModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: '#1C1C1E', width: '90%', maxWidth: '500px', padding: '30px', borderRadius: '24px', boxShadow: '0 25px 50px rgba(0,0,0,0.7)', border: `1px solid ${theme.border}` }}>
                <h3 style={{ marginTop: 0, color: 'white', marginBottom: '15px', fontSize: '1.3rem', fontWeight: '700' }}>New Content</h3>
                
                {/* Selector de Pestañas */}
                <div style={{ display: 'flex', gap: '15px', borderBottom: `1px solid ${theme.border}`, marginBottom: '20px', paddingBottom: '10px' }}>
                    <button onClick={() => setImportTab("manual")} style={{ 
                        background: 'none', border: 'none', color: importTab === 'manual' ? theme.accent : theme.textSecondary,
                        fontSize: '0.95rem', fontWeight: '600', cursor: 'pointer', outline: 'none',
                        borderBottom: importTab === 'manual' ? `2px solid ${theme.accent}` : 'none', paddingBottom: '5px'
                    }}>
                        Manual Text
                    </button>
                    <button onClick={() => setImportTab("pdf")} style={{ 
                        background: 'none', border: 'none', color: importTab === 'pdf' ? theme.accent : theme.textSecondary,
                        fontSize: '0.95rem', fontWeight: '600', cursor: 'pointer', outline: 'none',
                        borderBottom: importTab === 'pdf' ? `2px solid ${theme.accent}` : 'none', paddingBottom: '5px'
                    }}>
                        Import PDF
                    </button>
                    <button onClick={() => setImportTab("audio")} style={{ 
                        background: 'none', border: 'none', color: importTab === 'audio' ? '#30D158' : theme.textSecondary,
                        fontSize: '0.95rem', fontWeight: '600', cursor: 'pointer', outline: 'none',
                        borderBottom: importTab === 'audio' ? `2px solid #30D158` : 'none', paddingBottom: '5px'
                    }}>
                        🎧 Audio
                    </button>
                </div>

                {importTab === "manual" ? (
                    <>
                        <input 
                            type="text" placeholder="Title" value={newTitle} onChange={e => setNewTitle(e.target.value)}
                            style={{ width: '100%', padding: '16px', background: '#2C2C2E', border: 'none', borderRadius: '12px', color: 'white', marginBottom: '12px', fontSize: '1rem', outline: 'none' }}
                        />
                        <textarea 
                            placeholder="Content..." value={newContent} onChange={e => setNewContent(e.target.value)}
                            style={{ width: '100%', height: '140px', padding: '16px', background: '#2C2C2E', border: 'none', borderRadius: '12px', color: 'white', marginBottom: '12px', fontSize: '1rem', resize: 'none', fontFamily: 'inherit', outline: 'none' }}
                        />

                        {/* Selección de Idioma */}
                        <div style={{ marginBottom: '12px' }}>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: theme.textSecondary, marginBottom: '6px', fontWeight: '700', letterSpacing: '0.5px' }}>LANGUAGE</label>
                            <select 
                                value={manualLang} onChange={e => setManualLang(e.target.value)}
                                style={{ width: '100%', padding: '12px 14px', background: '#2C2C2E', border: 'none', borderRadius: '12px', color: 'white', fontSize: '0.9rem', outline: 'none', cursor: 'pointer' }}
                            >
                                <option value="fr">🇫🇷 French (Français)</option>
                                <option value="en">🇬🇧 English</option>
                                <option value="de">🇩🇪 German (Deutsch)</option>
                                <option value="es">🇪🇸 Spanish (Español)</option>
                                <option value="it">🇮🇹 Italian (Italiano)</option>
                            </select>
                        </div>

                        {/* Adjuntar Audio Opcional */}
                        <div style={{ marginBottom: '12px' }}>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: theme.textSecondary, marginBottom: '6px', fontWeight: '700', letterSpacing: '0.5px' }}>ATTACH AUDIO (OPTIONAL)</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <label style={{ 
                                    padding: '10px 14px', borderRadius: '10px', background: manualAudioFile ? 'rgba(48, 209, 88, 0.15)' : 'rgba(255,255,255,0.06)',
                                    color: manualAudioFile ? '#30D158' : '#fff', fontSize: '0.85rem', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px'
                                }}>
                                    <input 
                                        type="file" accept=".mp3,.m4a,.wav,.ogg,.aac"
                                        onChange={e => setManualAudioFile(e.target.files[0] || null)}
                                        style={{ display: 'none' }}
                                    />
                                    <span>🎧</span> {manualAudioFile ? manualAudioFile.name : 'Choose Audio File...'}
                                </label>
                                {manualAudioFile && (
                                    <button 
                                        onClick={() => setManualAudioFile(null)} 
                                        style={{ background: 'none', border: 'none', color: '#FF453A', cursor: 'pointer', fontSize: '0.8rem' }}
                                    >
                                        Remove
                                    </button>
                                )}
                            </div>
                        </div>

                        {renderFolderSelector()}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '10px' }}>
                            <button onClick={() => setShowAddModal(false)} className="btn-secondary">Cancel</button>
                            <button onClick={handleSaveDocument} className="btn-primary">{isSaving ? 'Saving...' : 'Save Document'}</button>
                        </div>
                    </>
                ) : importTab === "pdf" ? (
                    <>
                        {/* Upload progress bar */}
                        {importingPdf && pdfUploadProgress < 100 && (
                            <div style={{ marginBottom: '16px' }}>
                                <div style={{ fontSize: '0.8rem', color: theme.textSecondary, marginBottom: '6px' }}>Uploading PDF... {pdfUploadProgress}%</div>
                                <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px' }}>
                                    <div style={{ height: '100%', width: `${pdfUploadProgress}%`, background: theme.accent, borderRadius: '2px', transition: 'width 0.2s' }} />
                                </div>
                            </div>
                        )}
                        {importingPdf && pdfUploadProgress >= 100 && (
                            <div style={{ marginBottom: '16px', fontSize: '0.8rem', color: '#30D158' }}>✅ PDF uploaded. Processing text...</div>
                        )}
                        <div style={{ 
                            border: `2px dashed ${pdfFile ? theme.accent : theme.border}`, 
                            borderRadius: '16px', padding: '24px 20px', textAlign: 'center', marginBottom: '16px',
                            background: pdfFile ? 'rgba(10, 132, 255, 0.05)' : 'transparent', transition: 'all 0.3s'
                        }}>
                            <label style={{ cursor: 'pointer', display: 'block' }}>
                                <input 
                                    type="file" accept=".pdf" 
                                    onChange={e => {
                                        const file = e.target.files[0];
                                        setPdfFile(file);
                                        if (file && !pdfTitle) {
                                            setPdfTitle(file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' '));
                                        }
                                    }}
                                    style={{ display: 'none' }}
                                />
                                <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>📄</div>
                                <div style={{ fontWeight: '600', color: pdfFile ? theme.accent : '#fff', marginBottom: '5px', wordBreak: 'break-all' }}>
                                    {pdfFile ? pdfFile.name : "Select your annotated PDF"}
                                </div>
                                <div style={{ fontSize: '0.8rem', color: theme.textSecondary }}>
                                    {pdfFile ? `${(pdfFile.size / 1024 / 1024).toFixed(2)} MB` : "Highlighted words and surrounding context will be extracted"}
                                </div>
                            </label>
                        </div>

                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ display: 'block', fontSize: '0.8rem', color: theme.textSecondary, marginBottom: '6px', fontWeight: '700', letterSpacing: '0.5px' }}>DOCUMENT TITLE</label>
                            <input 
                                type="text" 
                                placeholder={pdfFile ? pdfFile.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ') : "e.g. That Will Never Work"} 
                                value={pdfTitle} 
                                onChange={e => setPdfTitle(e.target.value)}
                                style={{ width: '100%', padding: '14px', background: '#2C2C2E', border: 'none', borderRadius: '12px', color: 'white', fontSize: '0.95rem', outline: 'none' }}
                            />
                        </div>

                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ display: 'block', fontSize: '0.8rem', color: theme.textSecondary, marginBottom: '6px', fontWeight: '700', letterSpacing: '0.5px' }}>PDF LANGUAGE</label>
                            <div style={{ position: 'relative', width: '100%' }}>
                                <select 
                                    value={pdfLang} onChange={e => setPdfLang(e.target.value)}
                                    style={{ appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none', width: '100%', padding: '14px 40px 14px 14px', background: '#2C2C2E', border: 'none', borderRadius: '12px', color: 'white', fontSize: '0.95rem', outline: 'none', cursor: 'pointer' }}
                                >
                                    <option value="en">English</option>
                                    <option value="de">German (Deutsch)</option>
                                    <option value="es">Spanish (Español)</option>
                                    <option value="fr">French (Français)</option>
                                </select>
                                <div style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', opacity: 0.6 }}>
                                    <ChevronIcon isOpen={false} />
                                </div>
                            </div>
                        </div>

                        {renderFolderSelector()}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '10px' }}>
                            <button onClick={() => { setShowAddModal(false); setPdfFile(null); setPdfTitle(''); }} className="btn-secondary">Cancel</button>
                            <button 
                                onClick={handleImportPdf} disabled={importingPdf} className="btn-primary"
                                style={{ opacity: importingPdf ? 0.6 : 1, cursor: importingPdf ? 'not-allowed' : 'pointer' }}
                            >
                                {importingPdf ? (pdfUploadProgress < 100 ? `Uploading ${pdfUploadProgress}%...` : 'Processing...') : 'Import & Analyze'}
                            </button>
                        </div>
                    </>
                ) : (
                    /* TAB AUDIO */
                    <>
                        {uploadingAudio && (
                            <div style={{ marginBottom: '16px' }}>
                                <div style={{ fontSize: '0.85rem', color: theme.textSecondary, marginBottom: '6px', fontWeight: '500' }}>
                                    {uploadStatusMsg || `Uploading audio... ${uploadProgress}%`}
                                </div>
                                <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px' }}>
                                    <div style={{ height: '100%', width: `${uploadProgress}%`, background: '#30D158', borderRadius: '2px', transition: 'width 0.2s' }} />
                                </div>
                            </div>
                        )}
                        <div style={{ 
                            border: `2px dashed ${audioFiles.length > 0 ? '#30D158' : theme.border}`, 
                            borderRadius: '16px', padding: '30px 20px', textAlign: 'center', marginBottom: '16px',
                            background: audioFiles.length > 0 ? 'rgba(48, 209, 88, 0.05)' : 'transparent', transition: 'all 0.3s'
                        }}>
                            <label style={{ cursor: 'pointer', display: 'block' }}>
                                <input 
                                    type="file" accept=".mp3,.m4a,.wav,.ogg,.aac" multiple
                                    onChange={e => {
                                        const files = Array.from(e.target.files);
                                        setAudioFiles(files);
                                        if (files.length === 1 && !audioTitle) {
                                            setAudioTitle(files[0].name.replace(/\.[^.]+$/, ''));
                                        }
                                    }}
                                    style={{ display: 'none' }}
                                />
                                <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>🎧</div>
                                <div style={{ fontWeight: '600', color: audioFiles.length > 0 ? '#30D158' : '#fff', marginBottom: '5px', wordBreak: 'break-all' }}>
                                    {audioFiles.length > 0 
                                        ? (audioFiles.length === 1 ? audioFiles[0].name : `${audioFiles.length} files selected`)
                                        : "Select your audio files"
                                    }
                                </div>
                                <div style={{ fontSize: '0.8rem', color: theme.textSecondary }}>
                                    {audioFiles.length > 0 
                                        ? `${(audioFiles.reduce((acc, f) => acc + f.size, 0) / 1024 / 1024).toFixed(1)} MB total`
                                        : 'MP3, M4A, WAV, OGG — uploaded to cloud (multi-select supported)'
                                    }
                                </div>
                            </label>
                        </div>

                        {audioFiles.length <= 1 && (
                            <div style={{ marginBottom: '16px' }}>
                                <label style={{ display: 'block', fontSize: '0.8rem', color: theme.textSecondary, marginBottom: '6px', fontWeight: '700', letterSpacing: '0.5px' }}>AUDIO TITLE</label>
                                <input 
                                    type="text" placeholder="Audiobook or episode title" value={audioTitle}
                                    onChange={e => setAudioTitle(e.target.value)}
                                    style={{ width: '100%', padding: '14px', background: '#2C2C2E', border: 'none', borderRadius: '12px', color: 'white', fontSize: '0.95rem', outline: 'none' }}
                                />
                            </div>
                        )}

                        {renderFolderSelector()}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
                            <button onClick={() => { setShowAddModal(false); setAudioFiles([]); setAudioTitle(''); }} className="btn-secondary">Cancel</button>
                            <button 
                                onClick={handleUploadAudio} disabled={uploadingAudio || audioFiles.length === 0} className="btn-primary"
                                style={{ opacity: (uploadingAudio || audioFiles.length === 0) ? 0.6 : 1, cursor: (uploadingAudio || audioFiles.length === 0) ? 'not-allowed' : 'pointer', background: '#30D158' }}
                            >
                                {uploadingAudio 
                                    ? 'Uploading... ☁' 
                                    : (audioFiles.length > 1 ? `Upload ${audioFiles.length} Audios ☁` : 'Upload Audio ☁')
                                }
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
      )}

      {/* MODAL MOVER DOCUMENTO A CARPETA */}
      {moveModalDoc && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3500, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#1C1C1E', width: '90%', maxWidth: '380px', padding: '24px', borderRadius: '20px', border: `1px solid ${theme.border}`, boxShadow: '0 25px 50px rgba(0,0,0,0.7)' }}>
            <h3 style={{ marginTop: 0, color: 'white', fontSize: '1.15rem', fontWeight: '700', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>📁</span> Move to Folder
            </h3>
            <p style={{ color: theme.textSecondary, fontSize: '0.85rem', marginBottom: '16px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {moveModalDoc.title}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px', maxHeight: '220px', overflowY: 'auto' }}>
              <button 
                onClick={() => { moveDocToFolder(moveModalDoc.id, ''); setMoveModalDoc(null); }}
                style={{ 
                  padding: '12px 14px', borderRadius: '10px', border: 'none', textAlign: 'left',
                  background: !docFolders[moveModalDoc.id] ? 'rgba(10, 132, 255, 0.2)' : 'rgba(255,255,255,0.05)',
                  color: !docFolders[moveModalDoc.id] ? '#0A84FF' : '#fff', cursor: 'pointer', fontWeight: '500',
                  display: 'flex', alignItems: 'center', gap: '8px'
                }}
              >
                <span>📄</span> No folder (General)
              </button>
              {folders.map(f => (
                <button 
                  key={f}
                  onClick={() => { moveDocToFolder(moveModalDoc.id, f); setMoveModalDoc(null); }}
                  style={{ 
                    padding: '12px 14px', borderRadius: '10px', border: 'none', textAlign: 'left',
                    background: docFolders[moveModalDoc.id] === f ? 'rgba(10, 132, 255, 0.2)' : 'rgba(255,255,255,0.05)',
                    color: docFolders[moveModalDoc.id] === f ? '#0A84FF' : '#fff', cursor: 'pointer', fontWeight: '500',
                    display: 'flex', alignItems: 'center', gap: '8px'
                  }}
                >
                  <span>📁</span> {f}
                </button>
              ))}
              {folders.length === 0 && (
                <div style={{ padding: '8px', fontSize: '0.8rem', color: theme.textSecondary, fontStyle: 'italic', textAlign: 'center' }}>
                  No folders created yet.
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button 
                onClick={() => {
                  const newName = prompt("New folder name:");
                  if (newName && newName.trim()) {
                    createFolder(newName.trim());
                    moveDocToFolder(moveModalDoc.id, newName.trim());
                    setMoveModalDoc(null);
                  }
                }}
                className="btn-secondary" 
                style={{ padding: '8px 12px', fontSize: '0.82rem', color: theme.accent }}
              >
                + New Folder
              </button>
              <button onClick={() => setMoveModalDoc(null)} className="btn-secondary" style={{ padding: '8px 14px', fontSize: '0.85rem' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL EDITAR DOCUMENTO NATIVO */}
      {editModalDoc && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3500, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ background: '#1C1C1E', width: '100%', maxWidth: '520px', padding: '28px', borderRadius: '24px', border: `1px solid ${theme.border}`, boxShadow: '0 25px 60px rgba(0,0,0,0.8)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.2rem' }}>✏️</span>
                <h3 style={{ margin: 0, color: 'white', fontSize: '1.25rem', fontWeight: '700' }}>Edit Document</h3>
              </div>
              <button 
                onClick={() => { setEditModalDoc(null); setEditDocAudioFile(null); }} 
                className="icon-btn" 
                style={{ padding: '6px', opacity: 0.6 }}
              >
                <CloseIconSimple />
              </button>
            </div>

            {/* Título */}
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: theme.textSecondary, marginBottom: '6px', fontWeight: '700', letterSpacing: '0.5px' }}>DOCUMENT TITLE</label>
              <input 
                type="text" 
                value={editDocTitle} 
                onChange={e => setEditDocTitle(e.target.value)}
                placeholder="Title"
                style={{ width: '100%', padding: '14px', background: '#2C2C2E', border: 'none', borderRadius: '12px', color: 'white', fontSize: '0.95rem', outline: 'none' }}
              />
            </div>

            {/* Idioma */}
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: theme.textSecondary, marginBottom: '6px', fontWeight: '700', letterSpacing: '0.5px' }}>LANGUAGE</label>
              <select 
                value={editDocLang} 
                onChange={e => setEditDocLang(e.target.value)}
                style={{ width: '100%', padding: '12px 14px', background: '#2C2C2E', border: 'none', borderRadius: '12px', color: 'white', fontSize: '0.9rem', outline: 'none', cursor: 'pointer' }}
              >
                <option value="fr">🇫🇷 French (Français)</option>
                <option value="en">🇬🇧 English</option>
                <option value="de">🇩🇪 German (Deutsch)</option>
                <option value="es">🇪🇸 Spanish (Español)</option>
                <option value="it">🇮🇹 Italian (Italiano)</option>
                <option value="audio">🎧 Audio Track</option>
              </select>
            </div>

            {/* Audio Adjunto / Estado */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: theme.textSecondary, marginBottom: '6px', fontWeight: '700', letterSpacing: '0.5px' }}>ATTACHED AUDIO</label>
              {editModalDoc.audio_url ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: '12px', background: 'rgba(48, 209, 88, 0.1)', border: '1px solid rgba(48, 209, 88, 0.2)', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#30D158', fontSize: '0.85rem', fontWeight: '600' }}>
                    <span>✅</span> Audio linked and ready
                  </div>
                  <button 
                    onClick={() => {
                      setEditModalDoc(prev => ({ ...prev, audio_url: null }));
                    }}
                    style={{ background: 'none', border: 'none', color: '#FF453A', fontSize: '0.75rem', cursor: 'pointer', fontWeight: '600' }}
                  >
                    Unlink
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: '0.8rem', color: theme.textSecondary, marginBottom: '8px' }}>
                  No audio currently linked to this document.
                </div>
              )}

              {/* Input para adjuntar o reemplazar audio */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <label style={{ 
                  padding: '10px 14px', borderRadius: '10px', 
                  background: editDocAudioFile ? 'rgba(48, 209, 88, 0.15)' : 'rgba(255,255,255,0.06)',
                  color: editDocAudioFile ? '#30D158' : '#fff', fontSize: '0.85rem', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px'
                }}>
                  <input 
                    type="file" accept=".mp3,.m4a,.wav,.ogg,.aac"
                    onChange={e => setEditDocAudioFile(e.target.files[0] || null)}
                    style={{ display: 'none' }}
                  />
                  <span>🎧</span> {editDocAudioFile ? editDocAudioFile.name : (editModalDoc.audio_url ? 'Replace Audio File...' : 'Attach Audio File...')}
                </label>
                {editDocAudioFile && (
                  <button 
                    onClick={() => setEditDocAudioFile(null)} 
                    style={{ background: 'none', border: 'none', color: '#FF453A', cursor: 'pointer', fontSize: '0.8rem' }}
                  >
                    Cancel
                  </button>
                )}
              </div>
              {editAudioProgress > 0 && editAudioProgress < 100 && (
                <div style={{ marginTop: '8px' }}>
                  <div style={{ fontSize: '0.75rem', color: theme.textSecondary, marginBottom: '4px' }}>Uploading audio... {editAudioProgress}%</div>
                  <div style={{ height: '3px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px' }}>
                    <div style={{ height: '100%', width: `${editAudioProgress}%`, background: '#30D158', borderRadius: '2px' }} />
                  </div>
                </div>
              )}
            </div>

            {/* Botones de acción */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
              <button 
                onClick={() => { setEditModalDoc(null); setEditDocAudioFile(null); }} 
                className="btn-secondary"
                disabled={isSavingEdit}
              >
                Cancel
              </button>
              <button 
                onClick={handleUpdateDocument} 
                disabled={isSavingEdit}
                className="btn-primary"
                style={{ opacity: isSavingEdit ? 0.6 : 1 }}
              >
                {isSavingEdit ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL LISTA DE VOCABULARIO */}
      {showVocabModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 2500,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px'
        }}>
          <div style={{
            background: '#161618',
            borderRadius: '24px',
            border: '1px solid rgba(255,255,255,0.08)',
            width: '100%', maxWidth: '820px', height: '88vh', maxHeight: '780px',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden', boxShadow: '0 25px 60px rgba(0,0,0,0.6)'
          }}>
            {/* Encabezado del modal */}
            <div style={{
              padding: '22px 26px 16px 26px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '32px', height: '32px', borderRadius: '10px',
                    background: 'rgba(255, 179, 64, 0.15)', color: '#FFB340',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <VocabIcon />
                  </div>
                  <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: '700', color: '#fff', letterSpacing: '-0.3px' }}>
                    Vocabulary Dictionary
                  </h2>
                </div>
                <p style={{ margin: '6px 0 0 0', color: theme.textSecondary, fontSize: '0.82rem' }}>
                  All highlighted & translated words from your readings, organized for study.
                </p>
              </div>
              <button 
                onClick={() => setShowVocabModal(false)}
                className="icon-btn"
                style={{ padding: '6px', opacity: 0.7, background: 'rgba(255,255,255,0.06)', borderRadius: '50%' }}
              >
                <CloseIconSimple />
              </button>
            </div>

            {/* Barra de Filtros y Búsqueda */}
            <div style={{
              padding: '14px 26px',
              borderBottom: '1px solid rgba(255,255,255,0.04)',
              background: 'rgba(255,255,255,0.02)',
              display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'space-between'
            }}>
              {/* Tabs de Idioma */}
              <div style={{ display: 'flex', gap: '6px', background: 'rgba(0,0,0,0.3)', padding: '3px', borderRadius: '10px' }}>
                {[
                  { id: 'all', label: 'All' },
                  { id: 'fr', label: '🇫🇷 Français' },
                  { id: 'en', label: '🇬🇧 English' },
                  { id: 'de', label: '🇩🇪 Deutsch' },
                  { id: 'it', label: '🇮🇹 Italiano' }
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setVocabLanguageFilter(tab.id)}
                    style={{
                      padding: '6px 12px', borderRadius: '8px', border: 'none',
                      fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer',
                      background: vocabLanguageFilter === tab.id ? 'rgba(255, 179, 64, 0.2)' : 'transparent',
                      color: vocabLanguageFilter === tab.id ? '#FFB340' : theme.textSecondary,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Buscador */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                background: 'rgba(255,255,255,0.05)', borderRadius: '10px',
                padding: '6px 12px', flex: '1 1 200px', maxWidth: '300px',
                border: '1px solid rgba(255,255,255,0.06)'
              }}>
                <SearchSmallIcon />
                <input
                  type="text"
                  placeholder="Filter words..."
                  value={vocabSearchQuery}
                  onChange={(e) => setVocabSearchQuery(e.target.value)}
                  style={{
                    background: 'transparent', border: 'none', outline: 'none',
                    color: '#fff', fontSize: '0.82rem', width: '100%'
                  }}
                />
                {vocabSearchQuery && (
                  <button 
                    onClick={() => setVocabSearchQuery('')} 
                    style={{ background: 'none', border: 'none', color: theme.textSecondary, cursor: 'pointer', padding: 0 }}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {/* Contenido / Tabla de Palabras */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 26px 20px 26px' }}>
              {(() => {
                // Unir palabras de word_cache y subrayadas de documentos
                const vocabMap = new Map();

                // 1. Mapa rápido de palabras en caché por palabra (minúsculas)
                const cacheByWord = new Map();
                cachedVocabList.forEach(item => {
                  const wKey = (item.word || '').toLowerCase();
                  if (!cacheByWord.has(wKey)) {
                    cacheByWord.set(wKey, item);
                  }
                  const fullKey = `${wKey}_${(item.language || '').toLowerCase()}`;
                  const tData = item.translation_data || {};
                  vocabMap.set(fullKey, {
                    word: item.word,
                    language: item.language || 'auto',
                    translation: tData.translation || tData.translation_es || tData.meaning || '—',
                    grammar: tData.grammar || tData.part_of_speech || 'Vocabulary',
                    explanation: tData.explanation || tData.definition || '',
                    sourceDoc: null,
                    context: tData.context || '',
                    cachedItem: item
                  });
                });

                // 2. Añadir palabras subrayadas de los documentos cargados
                cloudBooks.forEach(doc => {
                  if (!doc.content) return;
                  const parts = doc.content.split('\n---\n');
                  const hlPart = parts[1] || '';
                  if (!hlPart) return;
                  
                  const words = hlPart.split(',').map(w => w.trim()).filter(Boolean);
                  const docLang = doc.language || 'auto';
                  
                  words.forEach(rawWord => {
                    if (rawWord.startsWith('phrase:')) {
                      const phraseParts = rawWord.split(':');
                      const pText = phraseParts.slice(3).join(':');
                      const pKey = pText.toLowerCase();
                      const matchedCache = cacheByWord.get(pKey);
                      const key = `${pKey}_${(matchedCache?.language || docLang).toLowerCase()}`;
                      
                      if (!vocabMap.has(key)) {
                        const tData = matchedCache?.translation_data || {};
                        vocabMap.set(key, {
                          word: pText,
                          language: matchedCache?.language || docLang,
                          translation: tData.translation || tData.translation_es || tData.meaning || 'Click to translate',
                          grammar: tData.grammar || tData.part_of_speech || 'Phrase',
                          explanation: tData.explanation || tData.definition || '',
                          sourceDoc: doc.title,
                          context: tData.context || '',
                          cachedItem: matchedCache || null
                        });
                      } else {
                        const existing = vocabMap.get(key);
                        if (!existing.sourceDoc) existing.sourceDoc = doc.title;
                        if (!existing.cachedItem && matchedCache) {
                          existing.cachedItem = matchedCache;
                          const tData = matchedCache.translation_data || {};
                          if (existing.translation === 'Click to translate') {
                            existing.translation = tData.translation || tData.translation_es || tData.meaning || '—';
                          }
                          if (tData.grammar) existing.grammar = tData.grammar;
                        }
                      }
                    } else {
                      const clean = rawWord.toLowerCase();
                      const matchedCache = cacheByWord.get(clean);
                      const key = `${clean}_${(matchedCache?.language || docLang).toLowerCase()}`;
                      
                      if (!vocabMap.has(key)) {
                        const tData = matchedCache?.translation_data || {};
                        vocabMap.set(key, {
                          word: rawWord,
                          language: matchedCache?.language || docLang,
                          translation: tData.translation || tData.translation_es || tData.meaning || 'Click to translate',
                          grammar: tData.grammar || tData.part_of_speech || 'Word',
                          explanation: tData.explanation || tData.definition || '',
                          sourceDoc: doc.title,
                          context: tData.context || '',
                          cachedItem: matchedCache || null
                        });
                      } else {
                        const existing = vocabMap.get(key);
                        if (!existing.sourceDoc) existing.sourceDoc = doc.title;
                        if (!existing.cachedItem && matchedCache) {
                          existing.cachedItem = matchedCache;
                          const tData = matchedCache.translation_data || {};
                          if (existing.translation === 'Click to translate') {
                            existing.translation = tData.translation || tData.translation_es || tData.meaning || '—';
                          }
                          if (tData.grammar) existing.grammar = tData.grammar;
                        }
                      }
                    }
                  });
                });

                let items = Array.from(vocabMap.values());

                // Filtrar por idioma
                if (vocabLanguageFilter !== 'all') {
                  items = items.filter(i => {
                    const l = (i.language || '').toLowerCase();
                    return l === vocabLanguageFilter || l.startsWith(vocabLanguageFilter);
                  });
                }

                // Filtrar por término de búsqueda
                if (vocabSearchQuery.trim()) {
                  const q = vocabSearchQuery.trim().toLowerCase();
                  items = items.filter(i => 
                    i.word.toLowerCase().includes(q) || 
                    (i.translation && i.translation.toLowerCase().includes(q)) ||
                    (i.sourceDoc && i.sourceDoc.toLowerCase().includes(q))
                  );
                }

                if (isLoadingVocab && items.length === 0) {
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 0', gap: '12px', color: theme.textSecondary }}>
                      <SpinnerIcon />
                      <span style={{ fontSize: '0.85rem' }}>Loading vocabulary...</span>
                    </div>
                  );
                }

                if (items.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', padding: '60px 20px', color: theme.textSecondary }}>
                      <div style={{ fontSize: '2rem', marginBottom: '10px' }}>📖</div>
                      <p style={{ margin: 0, fontSize: '0.95rem', fontWeight: '500', color: '#fff' }}>No words found</p>
                      <p style={{ margin: '6px 0 0 0', fontSize: '0.8rem' }}>
                        {vocabSearchQuery ? "No matches for your search." : "Highlight or click any word while reading to save it here automatically."}
                      </p>
                    </div>
                  );
                }

                return (
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', marginTop: '10px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                        <th style={{ padding: '12px 10px', fontSize: '0.75rem', fontWeight: '700', color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                          Word / Expression ({items.length})
                        </th>
                        <th style={{ padding: '12px 10px', fontSize: '0.75rem', fontWeight: '700', color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                          Translation & Definition
                        </th>
                        <th style={{ padding: '12px 10px', fontSize: '0.75rem', fontWeight: '700', color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                          Language
                        </th>
                        <th style={{ padding: '12px 10px', fontSize: '0.75rem', fontWeight: '700', color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.8px', textAlign: 'right' }}>
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, idx) => {
                        const isTranslated = item.translation && item.translation !== 'Click to translate' && item.translation !== '—';
                        return (
                          <tr
                            key={idx}
                            onClick={() => {
                              // Al hacer clic, abrir detalle de la palabra sin cerrar el modal de vocabulario
                              if (item.cachedItem && item.cachedItem.translation_data) {
                                setSelectedWord({
                                  word: item.word,
                                  language: item.language,
                                  ...item.cachedItem.translation_data,
                                  fromCache: true
                                });
                              } else {
                                handleWordClick(item.word, item.context || "");
                              }
                            }}
                            style={{
                              borderBottom: '1px solid rgba(255,255,255,0.03)',
                              cursor: 'pointer', transition: 'background 0.15s'
                            }}
                            onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)'}
                            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            {/* Columna Palabra */}
                            <td style={{ padding: '14px 10px', verticalAlign: 'middle' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '1rem', fontWeight: '600', color: '#FFD60A' }}>
                                  {item.word}
                                </span>
                                {item.grammar && (
                                  <span style={{
                                    fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px',
                                    background: 'rgba(255,255,255,0.06)', color: theme.textSecondary,
                                    textTransform: 'uppercase', fontWeight: '600'
                                  }}>
                                    {item.grammar}
                                  </span>
                                )}
                              </div>
                              {item.sourceDoc && (
                                <div style={{ fontSize: '0.72rem', color: theme.textSecondary, marginTop: '2px' }}>
                                  📄 {item.sourceDoc}
                                </div>
                              )}
                            </td>

                            {/* Columna Traducción */}
                            <td style={{ padding: '14px 10px', verticalAlign: 'middle' }}>
                              <div style={{ fontSize: '0.9rem', color: isTranslated ? '#fff' : theme.textSecondary, fontWeight: isTranslated ? '500' : '400' }}>
                                {item.translation}
                              </div>
                              {item.explanation && (
                                <div style={{ fontSize: '0.75rem', color: theme.textSecondary, marginTop: '2px', maxWidth: '380px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {item.explanation}
                                </div>
                              )}
                            </td>

                            {/* Columna Idioma */}
                            <td style={{ padding: '14px 10px', verticalAlign: 'middle' }}>
                              <span style={{
                                fontSize: '0.75rem', fontWeight: '700', padding: '3px 8px', borderRadius: '6px',
                                background: item.language === 'fr' ? 'rgba(10, 132, 255, 0.15)' : 'rgba(255,255,255,0.06)',
                                color: item.language === 'fr' ? '#0A84FF' : '#aaa', textTransform: 'uppercase'
                              }}>
                                {item.language}
                              </span>
                            </td>

                            {/* Columna Acción / Bocina */}
                            <td style={{ padding: '14px 10px', verticalAlign: 'middle', textAlign: 'right' }}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  playWordAudio(item.word, item.language);
                                }}
                                className="icon-btn"
                                title="Listen pronunciation"
                                style={{
                                  padding: '6px', borderRadius: '50%',
                                  background: 'rgba(255,255,255,0.05)', display: 'inline-flex'
                                }}
                              >
                                <SpeakerIcon />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* MODAL PALABRA */}
      {selectedWord && (
          <>
            <div onClick={() => {
              if (Date.now() - modalOpenedTime.current > 400) {
                handleCloseModal();
              }
            }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 3100 }} />
            <div style={{ 
                position: 'fixed', bottom: 0, left: 0, right: 0, 
                backgroundColor: theme.modalBg, backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)',
                borderRadius: '24px 24px 0 0', padding: '30px 24px 50px 24px', zIndex: 3200, 
                boxShadow: '0 -10px 40px rgba(0,0,0,0.5)', borderTop: `1px solid rgba(255,255,255,0.1)`, 
                animation: 'slideUp 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)', maxHeight: '80vh', overflowY: 'auto' 
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <h2 style={{ margin: 0, fontSize: '2.4rem', fontFamily: '"New York", serif', fontWeight: '700', color: '#fff', textTransform: 'capitalize' }}>
                                {selectedWord.word}
                            </h2>
                            {/* BOTÓN DE AUDIO (SPEAKER) */}
                            <button onClick={() => playWordAudio(selectedWord.word, selectedWord.language)} className="icon-btn" style={{ background: 'rgba(255,255,255,0.1)', padding: '8px', borderRadius: '50%' }}>
                                <SpeakerIcon />
                            </button>
                        </div>
                        {isLoading ? (
                            <span style={{ color: theme.accent, fontSize:'0.9rem' }}>Analyzing...</span>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ color: theme.textSecondary, fontSize:'0.9rem' }}>{(isDetailedMode && selectedWord.grammar) || "Vocabulary"}</span>
                                {isDetailedMode && selectedWord.grammar && <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: '0.9rem' }}>•</span>}
                                <span style={{ color: isDetailedMode ? '#30D158' : theme.textSecondary, fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    {isDetailedMode ? "Detailed" : "Simple"}
                                </span>
                            </div>
                        )}
                    </div>
                    <button onClick={handleCloseModal} className="icon-btn" style={{ margin: '-5px -5px 0 0' }}><CloseIconCircle /></button>
                </div>
                
                <div style={{ opacity: isLoading ? 0.5 : 1, transition: 'opacity 0.3s' }}>
                    {/* TOGGLE MODO DE VOCABULARIO */}
                    <div style={{ 
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
                        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)',
                        borderRadius: '16px', padding: '12px 18px', marginBottom: '20px'
                    }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'left' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#fff' }}>Detailed explanations</span>
                            <span style={{ fontSize: '0.7rem', color: theme.textSecondary }}>Includes grammar, definitions, and usage examples</span>
                        </div>
                        <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '46px', height: '26px', cursor: 'pointer' }}>
                            <input 
                                type="checkbox" 
                                checked={isDetailedMode}
                                onChange={(e) => {
                                    const nextVal = e.target.checked;
                                    setIsDetailedMode(nextVal);
                                }}
                                style={{ opacity: 0, width: 0, height: 0 }}
                            />
                            <span className="slider" style={{
                                position: 'absolute', inset: 0,
                                backgroundColor: isDetailedMode ? '#30D158' : 'rgba(255,255,255,0.15)',
                                transition: '0.2s', borderRadius: '34px'
                            }}>
                                <span style={{
                                    position: 'absolute', height: '20px', width: '20px',
                                    left: isDetailedMode ? '22px' : '4px', bottom: '3px',
                                    backgroundColor: 'white', transition: '0.2s', borderRadius: '50%'
                                }} />
                            </span>
                        </label>
                    </div>

                    {selectedWord.associatedPhrase && (
                        <div style={{ 
                            background: 'rgba(10, 132, 255, 0.08)',
                            border: '1px solid rgba(10, 132, 255, 0.15)',
                            borderRadius: '16px',
                            padding: '16px 20px',
                            marginBottom: '20px',
                            display: 'flex',
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '20px'
                        }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: '750', letterSpacing: '0.5px', color: '#0A84FF', textTransform: 'uppercase' }}>
                                    Part of a highlighted phrase
                                </span>
                                <p style={{ margin: 0, fontSize: '1rem', color: '#E5E5E7', fontStyle: 'italic', fontFamily: '"New York", serif', lineHeight: '1.4' }}>
                                    "{selectedWord.associatedPhrase.phraseText}"
                                </p>
                            </div>
                            <button 
                                onClick={() => handleWordClick(selectedWord.associatedPhrase.phraseText, dragParagraphText.current)}
                                style={{
                                    background: '#0A84FF',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '10px',
                                    padding: '10px 20px',
                                    fontSize: '0.85rem',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    transition: 'background 0.2s',
                                    outline: 'none',
                                    whiteSpace: 'nowrap',
                                    height: 'fit-content'
                                }}
                                onMouseOver={(e) => e.currentTarget.style.background = '#0070E3'}
                                onMouseOut={(e) => e.currentTarget.style.background = '#0A84FF'}
                            >
                                View phrase
                            </button>
                        </div>
                    )}
                    {selectedWord.isOfflineDict && (
                        <div style={{ 
                            background: 'rgba(48, 209, 88, 0.08)',
                            border: '1px dashed rgba(48, 209, 88, 0.3)',
                            borderRadius: '16px',
                            padding: '12px 20px',
                            marginBottom: '20px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            textAlign: 'center',
                            gap: '4px'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '0.9rem' }}>📖</span>
                                <span style={{ fontSize: '0.75rem', fontWeight: '700', letterSpacing: '0.5px', color: '#30D158', textTransform: 'uppercase' }}>
                                    Local Dictionary (Offline)
                                </span>
                            </div>
                            <p style={{ margin: 0, fontSize: '0.8rem', color: theme.textSecondary, lineHeight: '1.4' }}>
                                Saved to queue and will update in the database when connected to the internet.
                            </p>
                        </div>
                    )}
                    {!selectedWord.isOfflineDict && (selectedWord.fromCache || (!selectedWord.fromCache && !isDetailedMode)) && (
                        <div style={{ 
                            background: 'rgba(255, 159, 10, 0.05)',
                            border: '1px dashed rgba(255, 159, 10, 0.25)',
                            borderRadius: '16px',
                            padding: '16px 20px',
                            marginBottom: '20px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            textAlign: 'center',
                            gap: '8px'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '1rem' }}>⚠️</span>
                                <span style={{ fontSize: '0.75rem', fontWeight: '700', letterSpacing: '0.5px', color: '#FF9F0A', textTransform: 'uppercase' }}>
                                    {selectedWord.fromCache ? "Cached Translation" : "Quick Analysis"}
                                </span>
                            </div>
                            <p style={{ margin: '0 0 4px 0', fontSize: '0.85rem', color: theme.textSecondary, lineHeight: '1.4', textAlign: 'center' }}>
                                {selectedWord.fromCache 
                                    ? "Meaning may vary depending on the current context." 
                                    : "Showing quick translation without details to save mobile data."}
                            </p>
                            <button 
                                onClick={handleRefreshTranslation}
                                style={{
                                    alignSelf: 'center',
                                    background: 'rgba(255, 159, 10, 0.12)',
                                    color: '#FF9F0A',
                                    border: '1px solid rgba(255, 159, 10, 0.2)',
                                    borderRadius: '10px',
                                    padding: '8px 16px',
                                    fontSize: '0.8rem',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    transition: 'background 0.2s',
                                    outline: 'none',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '6px'
                                }}
                                onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255, 159, 10, 0.22)'}
                                onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255, 159, 10, 0.12)'}
                            >
                                Re-analyze context {isDetailedMode ? "Detailed 🔄" : "Simple 🔄"}
                            </button>
                        </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '25px' }}>
                        <div className="card-info"><div className="label">SPANISH</div><div className="val">{selectedWord.es}</div></div>
                        <div className="card-info"><div className="label">ENGLISH</div><div className="val">{selectedWord.en}</div></div>
                    </div>
                    {isDetailedMode && selectedWord.alternatives && selectedWord.alternatives.length > 0 && (
                        <div style={{ 
                            background: 'rgba(255,255,255,0.04)', 
                            padding: '16px 20px', 
                            borderRadius: '16px', 
                            marginBottom: '25px',
                            border: '1px solid rgba(255,255,255,0.05)'
                        }}>
                            <div style={{ fontSize: '0.7rem', color: '#86868b', fontWeight: '700', marginBottom: '6px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                                Alternative Meanings / Synonyms
                            </div>
                            <div style={{ fontSize: '1.05rem', fontWeight: '600', color: '#fff', textAlign: 'left' }}>
                                {selectedWord.alternatives.join(', ')}
                            </div>
                        </div>
                    )}
                    {isDetailedMode && selectedWord.examples && selectedWord.examples.length > 0 && (
                        <div style={{ paddingLeft: '8px', textAlign: 'left' }}>
                            <h3 style={{ fontSize: '0.8rem', color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>Context & Examples</h3>
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                                {(selectedWord.examples || []).map((ex, i) => (
                                    <li key={i} style={{ paddingLeft: '16px', borderLeft: `3px solid ${theme.accent}`, marginBottom: '16px' }}>
                                        <p style={{ margin: '0 0 6px 0', fontSize: '1.1rem', fontFamily: '"New York", serif', color: '#E5E5E7', fontStyle: 'italic' }}>"{typeof ex === 'string' ? ex : ex.original}"</p>
                                        {(typeof ex === 'object' && ex.es_translation) && <p style={{ margin: 0, fontSize: '0.9rem', color: '#86868b' }}>{ex.es_translation}</p>}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>
          </>
      )}

      <style>{`
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes slideDown { from { transform: translate(-50%, -20px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        .icon-btn { background: none; border: none; padding: 0; cursor: pointer; display: flex; align-items: center; justify-content: center; color: white; outline: none; transition: opacity 0.2s; }
        .icon-btn:hover { opacity: 0.7; }
        .icon-btn-player { background: none; border: none; color: white; cursor: pointer; outline: none; opacity: 0.9; transition: opacity 0.2s; }
        .icon-btn-player:hover { opacity: 1; }
        .btn-primary { background: #0A84FF; color: white; border: none; padding: 12px 24px; border-radius: 12px; font-weight: 600; cursor: pointer; font-size: 1rem; }
        .btn-secondary { background: transparent; color: #86868b; border: none; padding: 12px 20px; font-weight: 500; cursor: pointer; font-size: 1rem; }
        .card-info { background: #2C2C2E; padding: 16px; border-radius: 16px; }
        .card-info .label { font-size: 0.7rem; color: #86868b; font-weight: 700; margin-bottom: 6px; letter-spacing: 0.5px; }
        .card-info .val { font-size: 1.1rem; font-weight: 600; color: white; }
        .custom-range { -webkit-appearance: none; width: 100%; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.2); outline: none; cursor: pointer; }
        .custom-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 12px; height: 12px; border-radius: 50%; background: #ffffff; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.5); margin-top: -4px; transition: transform 0.1s; }
        .custom-range::-webkit-slider-thumb:hover { transform: scale(1.2); }
        .custom-range::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; }
        * { box-sizing: border-box; }
        button:focus { outline: none; }
      `}</style>
    </div>
  );
}

export default App;