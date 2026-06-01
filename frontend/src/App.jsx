import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import dataLocal from './data.json';
import rawTranscript from './transcript.txt?raw';

const getApiUrl = (path) => {
  if (import.meta.env.DEV) {
    // Use the same host that served the page — works for localhost AND LAN IP (e.g. 192.168.x.x)
    return `http://${window.location.hostname}:5000${path}`;
  }
  return path;
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

// --- ICONOS SVG ---
const MenuIcon = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>;
const PlusIcon = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>;
const PlayIcon = () => <svg width="42" height="42" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>;
const PauseIcon = () => <svg width="42" height="42" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>;
const BackIcon = () => <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>;
const ForwardIcon = () => <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>;
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
      const savedTime = localStorage.getItem(`audio-progress-${initAudio.title}`);
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
  const [currentDoc, setCurrentDoc] = useState(initialDocVal);
  const [activeAudio, setActiveAudio] = useState(initialAudioVal);
  const [currentPage, setCurrentPage] = useState(1);
  const currentPageRef = useRef(1);
  const pageHeightsRef = useRef({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  
  const [selectedWord, setSelectedWord] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");

  const [importTab, setImportTab] = useState("manual");
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfLang, setPdfLang] = useState("en");
  const [pdfAudioUrl, setPdfAudioUrl] = useState("");
  const [importingPdf, setImportingPdf] = useState(false);

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

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    pageHeightsRef.current = {};
  }, [currentDoc?.id]);

  const syncReadingProgress = async (docId, pageNum, scrollY) => {
    if (!docId || docId === 'demo') return;
    try {
      await fetch(getApiUrl(`/api/documents/${docId}/progress`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_page: pageNum, scroll_position: scrollY })
      });
    } catch (err) {
      console.warn("⚠️ Error al sincronizar progreso de lectura en SQLite:", err);
    }
  };

  // --- PERSISTENCIA DE LA POSICIÓN DE DESPLAZAMIENTO (SCROLL POSITION) ---
  useEffect(() => {
    if (!currentDoc || !currentDoc.id) return;
    
    // Restaurar posición de scroll anterior
    let timer;
    
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
    
    setCurrentPage(targetPage);
    currentPageRef.current = targetPage;
    
    if (targetScroll > 0) {
      // Un leve retardo para asegurar que el contenido memoizado terminó de renderizarse
      timer = setTimeout(() => {
        window.scrollTo({ top: targetScroll, behavior: 'instant' });
      }, 180);
    } else {
      window.scrollTo(0, 0);
    }

    let lastScrollSaveTime = 0;
    const saveImmediateScroll = (forcePage, forceScroll) => {
      const pageVal = forcePage !== undefined ? forcePage : (currentPageRef.current || 1);
      const scrollVal = forceScroll !== undefined ? forceScroll : window.scrollY;
      
      localStorage.setItem(`scroll-position-${currentDoc.id}`, scrollVal.toString());
      localStorage.setItem(`current-page-${currentDoc.id}`, pageVal.toString());
      
      syncReadingProgress(currentDoc.id, pageVal, scrollVal);
    };

    const handleScroll = () => {
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
      
      const newPage = closestPageIdx + 1;
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
      if (timer) clearTimeout(timer);
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
  const cloudBooks = useMemo(() => documents.filter(d => d.language !== 'audio'), [documents]);

  const [sidebarSections, setSidebarSections] = useState({ books: true, audios: true });

  // 1. Cargar documentos y archivos de Obsidian en startup
  useEffect(() => {
    const fetchDocs = async () => {
        try {
            const res = await fetch(getApiUrl('/api/documents'));
            const data = await res.json();
            const cloudDocs = Array.isArray(data) ? data : [];
            setDocuments(prev => {
                const demoDoc = prev.find(d => d.id === 'demo') || {
                  id: 'demo',
                  title: 'Demo: Podcast Alemán',
                  content: rawTranscript,
                  audio_url: '/podcast.mp3',
                  language: 'de',
                  created_at: new Date().toISOString()
                };
                const merged = [...cloudDocs, demoDoc];
                
                // Restaurar el último documento abierto
                const lastDocId = localStorage.getItem('last-opened-doc-id');
                if (lastDocId) {
                    const savedDoc = merged.find(d => d.id === lastDocId);
                    if (savedDoc) {
                        setCurrentDoc(prev => (prev && prev.id === savedDoc.id) ? prev : savedDoc);
                        localStorage.setItem('last-opened-doc', JSON.stringify(savedDoc));
                    } else {
                        setCurrentDoc(prev => (prev && prev.id === merged[0].id) ? prev : merged[0]);
                        localStorage.setItem('last-opened-doc', JSON.stringify(merged[0]));
                        localStorage.setItem('last-opened-doc-id', merged[0].id);
                    }
                } else {
                    setCurrentDoc(prev => (prev && prev.id === merged[0].id) ? prev : merged[0]);
                    localStorage.setItem('last-opened-doc', JSON.stringify(merged[0]));
                    localStorage.setItem('last-opened-doc-id', merged[0].id);
                }
                return merged;
            });
        } catch (err) {
            console.warn("⚠️ No se pudieron cargar los documentos locales:", err);
        }
    };
    fetchDocs();
  }, []);

  // 2. Guardar documento
  const handleSaveDocument = async () => {
    if (!newTitle || !newContent) return alert("Agrega título y contenido.");
    setIsSaving(true);
    
    try {
        const res = await fetch(getApiUrl('/api/documents'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newTitle, content: newContent, language: 'auto' })
        });
        const newDoc = await res.json();
        if (newDoc.error) throw new Error(newDoc.error);
        
        setDocuments(prev => [newDoc, ...prev]);
        setCurrentDoc(newDoc);
        setShowAddModal(false);
        setNewTitle("");
        setNewContent("");
    } catch (err) {
        alert("Error al guardar: " + err.message);
    } finally {
        setIsSaving(false);
    }
  };

  // 2b. Importar PDF via Supabase Storage (evita el límite de 4.5MB de Vercel)
  const handleImportPdf = async () => {
    if (!pdfFile) return alert("Por favor selecciona un archivo PDF.");
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return alert("Supabase no está configurado. Verifica las variables de entorno VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.");
    }
    setImportingPdf(true);
    setPdfUploadProgress(0);

    try {
      // 1. Subir PDF a Supabase Storage
      const storagePath = `pdfs/${Date.now()}_${pdfFile.name.replace(/\s+/g, '_')}`;
      await uploadToSupabaseStorage(pdfFile, storagePath, (pct) => setPdfUploadProgress(pct));

      // 2. Llamar al backend para extraer texto y guardar en Supabase
      const res = await fetch(getApiUrl('/api/process-storage-pdf'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storage_path: storagePath, filename: pdfFile.name, language: pdfLang })
      });
      const savedDoc = await res.json();
      if (savedDoc.error) throw new Error(savedDoc.error);

      setDocuments(prev => [savedDoc, ...prev]);
      setCurrentDoc(savedDoc);
      setShowAddModal(false);
      setPdfFile(null);
      setPdfAudioUrl('');
      setPdfUploadProgress(0);

      // Pre-cachear palabras subrayadas en segundo plano
      const parts = (savedDoc.content || '').split('\n---\n');
      const wordsPart = parts[1] || '';
      const highlights = wordsPart.split(',').map(w => ({ word: w.trim(), context: '' })).filter(h => h.word);
      if (highlights.length > 0) preCacheWords(highlights, pdfLang);

      alert(`🎉 PDF importado con éxito. ${highlights.length} palabras subrayadas encontradas.`);
    } catch (e) {
      alert("Error al importar PDF: " + e.message);
    } finally {
      setImportingPdf(false);
      setPdfUploadProgress(0);
    }
  };

  // 2c. Subir audio a Supabase Storage y registrar en la base de datos (Soporta múltiples archivos)
  const handleUploadAudio = async () => {
    if (audioFiles.length === 0) return alert("Por favor selecciona al menos un archivo de audio.");
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return alert("Supabase no está configurado. Verifica las variables de entorno.");
    }
    setUploadingAudio(true);
    setUploadProgress(0);

    let firstUploadedDoc = null;

    try {
      for (let i = 0; i < audioFiles.length; i++) {
        const file = audioFiles[i];
        setUploadStatusMsg(`Subiendo archivo ${i + 1} de ${audioFiles.length} (${file.name}): 0%`);
        setUploadProgress(0);

        // 1. Subir MP3 directamente a Supabase Storage desde el browser
        const storagePath = `audios/${Date.now()}_${i}_${file.name.replace(/\s+/g, '_')}`;
        await uploadToSupabaseStorage(file, storagePath, (pct) => {
          setUploadProgress(pct);
          setUploadStatusMsg(`Subiendo archivo ${i + 1} de ${audioFiles.length} (${file.name}): ${pct}%`);
        });

        setUploadStatusMsg(`Registrando archivo ${i + 1} de ${audioFiles.length}...`);

        // 2. Registrar metadata en Supabase via backend
        const title = (audioFiles.length === 1 && audioTitle.trim()) 
          ? audioTitle.trim() 
          : file.name.replace(/\.[^.]+$/, '');

        const res = await fetch(getApiUrl('/api/register-audio'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, title, storage_path: storagePath })
        });
        const newDoc = await res.json();
        if (newDoc.error) throw new Error(newDoc.error);

        setDocuments(prev => [newDoc, ...prev]);
        if (i === 0) {
          firstUploadedDoc = newDoc;
        }
      }

      setShowAddModal(false);
      setAudioFiles([]);
      setAudioTitle('');
      setUploadProgress(0);
      setUploadStatusMsg('');

      // Activar el primer audio subido de la lista
      if (firstUploadedDoc) {
        setActiveAudio({ url: firstUploadedDoc.audio_url, title: firstUploadedDoc.title });
      }
    } catch (e) {
      alert("Error al subir audio: " + e.message);
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
  }, [currentDoc?.id]);

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
    }
  }, [activeAudio]);

  // 3. Audio listeners (Podcast / Audiolibros desacoplados) con rendimiento optimizado (Throttling)
  useEffect(() => {
    setIsPlaying(false);
    setDuration(0);
    const audio = audioRef.current;
    if (!audio) return;
    
    // Cargar la nueva fuente
    audio.load();

    const saveImmediateAudioProgress = (timeToSave) => {
      if (activeAudio && activeAudio.title && timeToSave !== undefined) {
        // Prevent saving 0 or progress updates when the audio element has been reset (readyState < 1)
        if (audio && audio.readyState >= 1) {
          localStorage.setItem(`audio-progress-${activeAudio.title}`, timeToSave.toString());
        }
      }
    };

    // Cargar progreso del activeAudio y setearlo en el estado síncronamente
    let initialSeekTime = 0;
    if (activeAudio && activeAudio.title) {
      const savedTime = localStorage.getItem(`audio-progress-${activeAudio.title}`);
      if (savedTime) {
        const parsedTime = parseFloat(savedTime);
        if (!isNaN(parsedTime)) {
          initialSeekTime = parsedTime;
        }
      }
    }
    setCurrentTime(initialSeekTime);

    let hasSeeked = false;
    const restoreProgress = () => {
      if (hasSeeked) return;
      if (initialSeekTime > 0) {
        try {
          audio.currentTime = initialSeekTime;
          audio.playbackRate = playbackRate;
          hasSeeked = true;
          console.log("Restored playback position to:", initialSeekTime);
        } catch (err) {
          console.warn("Failed to seek audio:", err);
        }
      }
    };

    // Intentar restaurar progreso inmediatamente si los metadatos ya están cargados síncronamente
    if (initialSeekTime > 0 && audio.readyState >= 1) {
      restoreProgress();
    }

    let lastSaveTime = 0;
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
  }, [activeAudio]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      // Fallback: Si el currentTime está en 0, pero hay progreso guardado, restaurarlo justo antes de reproducir
      if (audio.currentTime === 0 && activeAudio && activeAudio.title) {
        const savedTime = localStorage.getItem(`audio-progress-${activeAudio.title}`);
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
      if (activeAudio && activeAudio.title && audio.readyState >= 1) {
        localStorage.setItem(`audio-progress-${activeAudio.title}`, audio.currentTime.toString());
      }
    }
  };

  const handleAudioMetadataLoaded = (e) => {
    const audio = e.currentTarget;
    setDuration(audio.duration);
    audio.playbackRate = playbackRate;

    // Restaurar progreso síncronamente en cuanto el elemento cargue los metadatos
    if (activeAudio && activeAudio.title) {
      const savedTime = localStorage.getItem(`audio-progress-${activeAudio.title}`);
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
    if (activeAudio && activeAudio.title) {
      localStorage.setItem(`audio-progress-${activeAudio.title}`, newTime.toString());
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
    if (activeAudio && activeAudio.title) {
      localStorage.setItem(`audio-progress-${activeAudio.title}`, t.toString());
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
  const playWordAudio = (word) => {
      if (!word) return;
      // Detenemos cualquier audio anterior
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(word);
      
      // Obtener el código de idioma adecuado
      let langCode = 'de-DE'; // Default
      if (currentDoc && currentDoc.language) {
        if (currentDoc.language === 'fr') langCode = 'fr-FR';
        if (currentDoc.language === 'en') langCode = 'en-US';
        if (currentDoc.language === 'es') langCode = 'es-ES';
      }
      
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
          // Guardar asíncronamente en SQLite a través del endpoint PUT
          fetch(getApiUrl(`/api/documents/${currentDoc.id}`), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: newContent })
          }).catch(err => console.warn("Error saving highlight to SQLite:", err));
        }
      }
    }

    setIsLoading(true);
    modalOpenedTime.current = Date.now();
    setSelectedWord({ word: cleanWord, es: "...", en: "...", examples: [], associatedPhrase });

    // CACHÉ
    try {
        const cacheRes = await fetch(getApiUrl(`/api/word_cache?word=${searchWord}&language=${currentDoc?.language || 'auto'}`));
        const cached = await cacheRes.json();

        if (cached) {
            if (isPopupClosedByUser.current) return;
            setSelectedWord({ word: cleanWord, ...cached.translation_data, associatedPhrase, fromCache: true });
            setIsLoading(false);
            return;
        }
    } catch (err) { console.error("Error caché:", err); }

    // API
    const API_URL = getApiUrl('/api/analyze');
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          word: searchWord, 
          context: surroundingSentence,
          language: currentDoc?.language || 'auto'
        })
      });
      const apiData = await res.json();
      if (apiData.error) throw new Error(apiData.error);

      if (isPopupClosedByUser.current) return;
      setSelectedWord({ word: cleanWord, ...apiData, associatedPhrase, fromCache: false });

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
        console.warn("⚠️ No se pudo guardar en la caché de la base de datos local:", dbErr);
      }
    } catch (e) {
      if (isPopupClosedByUser.current) return;
      setSelectedWord({ word: cleanWord, es: "Error", en: "Connection Error", grammar: "Revisa tu conexión", examples: [], associatedPhrase, fromCache: false });
    } finally {
      if (!isPopupClosedByUser.current) {
        setIsLoading(false);
      }
    }
  }, [currentDoc]);

  const handleRefreshTranslation = useCallback(async () => {
    if (!selectedWord) return;
    setIsLoading(true);
    isPopupClosedByUser.current = false;
    
    const searchWord = selectedWord.word.toLowerCase();
    const context = dragParagraphText.current || "";
    
    const API_URL = getApiUrl('/api/analyze');
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          word: searchWord, 
          context: context,
          language: currentDoc?.language || 'auto'
        })
      });
      const apiData = await res.json();
      if (apiData.error) throw new Error(apiData.error);

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
        console.warn("⚠️ No se pudo guardar en la caché de la base de datos local:", dbErr);
      }
    } catch (e) {
      if (isPopupClosedByUser.current) return;
      setSelectedWord({ 
        word: selectedWord.word, 
        es: "Error", 
        en: "Connection Error", 
        grammar: "Revisa tu conexión", 
        examples: [], 
        associatedPhrase: selectedWord.associatedPhrase, 
        fromCache: false 
      });
    } finally {
      if (!isPopupClosedByUser.current) {
        setIsLoading(false);
      }
    }
  }, [selectedWord, currentDoc]);

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
      return <div style={{ textAlign: 'center', marginTop: '100px', opacity: 0.5 }}>Cargando texto...</div>;
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

    return pageSplits.map((pageText, pIdx) => {
        const pageNum = pageMatches[pIdx - 1] || null; // El primer split está antes de la primera etiqueta
        const paragraphs = pageText.split('\n\n').filter(p => p.trim() !== '');

        if (paragraphs.length === 0) return null;

        const isNear = Math.abs(pIdx - (currentPage - 1)) <= 1;
        
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
                    {pageNum && <span>Página {pageNum}</span>}
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
                            Página {pageNum}
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
         <button onClick={() => {
             const now = new Date();
             setNewTitle(`Nota ${now.getDate()}/${now.getMonth()+1} ${now.getHours()}:${now.getMinutes()}`);
             setNewContent("");
             setShowAddModal(true);
         }} className="icon-btn" style={{ color: theme.accent }}><PlusIcon/></button>
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
              <h2 style={{ fontSize: '1.35rem', margin: 0, fontWeight: '700', letterSpacing: '-0.5px' }}>Biblioteca PWA</h2>
              <button onClick={() => setSidebarOpen(false)} className="icon-btn" style={{ opacity: 0.7 }}><CloseIconSimple/></button>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
              
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
                          Libros / Books
                      </span>
                      <ChevronIcon isOpen={sidebarSections.books} />
                  </div>
                  
                  {sidebarSections.books && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '4px', marginTop: '2px' }}>
                          {/* 1. Libros Procesados en SQLite */}
                          {cloudBooks.map(doc => (
                               <div key={doc.id} onClick={() => { setCurrentDoc(doc); setSidebarOpen(false); }} 
                                    style={{ 
                                        display: 'flex', alignItems: 'center', gap: '10px',
                                        padding: '10px 12px', borderRadius: '10px', cursor: 'pointer', 
                                        background: currentDoc?.id === doc.id ? 'rgba(10, 132, 255, 0.12)' : 'transparent',
                                        color: currentDoc?.id === doc.id ? '#0A84FF' : theme.text,
                                        transition: 'all 0.15s', fontSize: '0.9rem', fontWeight: currentDoc?.id === doc.id ? '600' : '400'
                                    }}
                                    onMouseOver={(e) => { if(currentDoc?.id !== doc.id) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)'; }}
                                    onMouseOut={(e) => { if(currentDoc?.id !== doc.id) e.currentTarget.style.backgroundColor = 'transparent'; }}
                               >
                                   <BookIcon />
                                   <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                       {doc.title.startsWith("Subrayados: ") ? doc.title.replace("Subrayados: ", "") : doc.title}
                                   </span>
                               </div>
                           ))}
                           
                           {cloudBooks.length === 0 && (
                               <div style={{ padding: '12px', fontSize: '0.85rem', color: theme.textSecondary, fontStyle: 'italic', textAlign: 'center' }}>
                                   Importa tu primer PDF con el botón +
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
                          Audios / Audiobooks
                      </span>
                      <ChevronIcon isOpen={sidebarSections.audios} />
                  </div>
                  
                  {sidebarSections.audios && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '4px', marginTop: '2px' }}>
                          {cloudAudiobooks.map(doc => {
                              const isActive = activeAudio?.url === doc.audio_url;
                              return (
                                  <div key={doc.id} 
                                       onClick={() => {
                                           setActiveAudio({ url: doc.audio_url, title: doc.title });
                                           setSidebarOpen(false);
                                       }}
                                       style={{ 
                                           display: 'flex', alignItems: 'center', gap: '10px',
                                           padding: '10px 12px', borderRadius: '10px', cursor: 'pointer', 
                                           background: isActive ? 'rgba(48, 209, 88, 0.12)' : 'transparent',
                                           color: isActive ? '#30D158' : theme.text,
                                           transition: 'all 0.15s', fontSize: '0.9rem', fontWeight: isActive ? '600' : '400'
                                       }}
                                       onMouseOver={(e) => { if(!isActive) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)'; }}
                                       onMouseOut={(e) => { if(!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
                                  >
                                      <AudioIcon />
                                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                          {doc.title}
                                      </span>
                                      {isActive && (
                                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#30D158', display: 'inline-block' }} />
                                      )}
                                  </div>
                              );
                          })}
                          
                          {cloudAudiobooks.length === 0 && (
                              <div style={{ padding: '12px', fontSize: '0.85rem', color: theme.textSecondary, fontStyle: 'italic', textAlign: 'center' }}>
                                  Sube un audiolibro con el botón +
                              </div>
                          )}
                      </div>
                  )}
              </div>
              
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
                    <div style={{ fontSize: '0.75rem', color: '#86868b' }}>Audio Escucha</div>
                </div>
                <div style={{ display: 'inline-block' }}>
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
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '30px' }}>
                    <button onClick={() => skipTime(-10)} className="icon-btn-player"><BackIcon/></button>
                    <button onClick={togglePlay} className="icon-btn-player" style={{ transform: 'scale(1.2)' }}>{isPlaying ? <PauseIcon/> : <PlayIcon/>}</button>
                    <button onClick={() => skipTime(10)} className="icon-btn-player"><ForwardIcon/></button>
                </div>
            </div>
            <audio ref={audioRef} src={activeAudio.url} onLoadedMetadata={handleAudioMetadataLoaded} />
        </div>
      )}



      {/* MODAL AGREGAR TEXTO */}
      {showAddModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: '#1C1C1E', width: '90%', maxWidth: '500px', padding: '30px', borderRadius: '24px', boxShadow: '0 25px 50px rgba(0,0,0,0.7)', border: `1px solid ${theme.border}` }}>
                <h3 style={{ marginTop: 0, color: 'white', marginBottom: '15px', fontSize: '1.3rem', fontWeight: '700' }}>Nuevo Texto</h3>
                
                {/* Selector de Pestañas */}
                <div style={{ display: 'flex', gap: '15px', borderBottom: `1px solid ${theme.border}`, marginBottom: '20px', paddingBottom: '10px' }}>
                    <button onClick={() => setImportTab("manual")} style={{ 
                        background: 'none', border: 'none', color: importTab === 'manual' ? theme.accent : theme.textSecondary,
                        fontSize: '0.95rem', fontWeight: '600', cursor: 'pointer', outline: 'none',
                        borderBottom: importTab === 'manual' ? `2px solid ${theme.accent}` : 'none', paddingBottom: '5px'
                    }}>
                        Texto Manual
                    </button>
                    <button onClick={() => setImportTab("pdf")} style={{ 
                        background: 'none', border: 'none', color: importTab === 'pdf' ? theme.accent : theme.textSecondary,
                        fontSize: '0.95rem', fontWeight: '600', cursor: 'pointer', outline: 'none',
                        borderBottom: importTab === 'pdf' ? `2px solid ${theme.accent}` : 'none', paddingBottom: '5px'
                    }}>
                        Importar PDF
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
                            type="text" placeholder="Título" value={newTitle} onChange={e => setNewTitle(e.target.value)}
                            style={{ width: '100%', padding: '16px', background: '#2C2C2E', border: 'none', borderRadius: '12px', color: 'white', marginBottom: '12px', fontSize: '1rem', outline: 'none' }}
                        />
                        <textarea 
                            placeholder="Contenido..." value={newContent} onChange={e => setNewContent(e.target.value)}
                            style={{ width: '100%', height: '200px', padding: '16px', background: '#2C2C2E', border: 'none', borderRadius: '12px', color: 'white', marginBottom: '24px', fontSize: '1rem', resize: 'none', fontFamily: 'inherit', outline: 'none' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <button onClick={() => setShowAddModal(false)} className="btn-secondary">Cancelar</button>
                            <button onClick={handleSaveDocument} className="btn-primary">{isSaving ? 'Guardando...' : 'Guardar'}</button>
                        </div>
                    </>
                ) : importTab === "pdf" ? (
                    <>
                        {/* Upload progress bar */}
                        {importingPdf && pdfUploadProgress < 100 && (
                            <div style={{ marginBottom: '16px' }}>
                                <div style={{ fontSize: '0.8rem', color: theme.textSecondary, marginBottom: '6px' }}>Subiendo PDF... {pdfUploadProgress}%</div>
                                <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px' }}>
                                    <div style={{ height: '100%', width: `${pdfUploadProgress}%`, background: theme.accent, borderRadius: '2px', transition: 'width 0.2s' }} />
                                </div>
                            </div>
                        )}
                        {importingPdf && pdfUploadProgress >= 100 && (
                            <div style={{ marginBottom: '16px', fontSize: '0.8rem', color: '#30D158' }}>✅ PDF subido. Procesando texto...</div>
                        )}
                        <div style={{ 
                            border: `2px dashed ${pdfFile ? theme.accent : theme.border}`, 
                            borderRadius: '16px', padding: '30px 20px', textAlign: 'center', marginBottom: '20px',
                            background: pdfFile ? 'rgba(10, 132, 255, 0.05)' : 'transparent', transition: 'all 0.3s'
                        }}>
                            <label style={{ cursor: 'pointer', display: 'block' }}>
                                <input 
                                    type="file" accept=".pdf" onChange={e => setPdfFile(e.target.files[0])}
                                    style={{ display: 'none' }}
                                />
                                <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>📄</div>
                                <div style={{ fontWeight: '600', color: pdfFile ? theme.accent : '#fff', marginBottom: '5px', wordBreak: 'break-all' }}>
                                    {pdfFile ? pdfFile.name : "Selecciona tu PDF anotado"}
                                </div>
                                <div style={{ fontSize: '0.8rem', color: theme.textSecondary }}>
                                    {pdfFile ? `${(pdfFile.size / 1024 / 1024).toFixed(2)} MB` : "Se extraerán las palabras subrayadas y su contexto"}
                                </div>
                            </label>
                        </div>

                        <div style={{ marginBottom: '24px' }}>
                            <label style={{ display: 'block', fontSize: '0.8rem', color: theme.textSecondary, marginBottom: '8px', fontWeight: '700', letterSpacing: '0.5px' }}>IDIOMA DEL PDF</label>
                            <div style={{ position: 'relative', width: '100%' }}>
                                <select 
                                    value={pdfLang} onChange={e => setPdfLang(e.target.value)}
                                    style={{ appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none', width: '100%', padding: '16px 40px 16px 16px', background: '#2C2C2E', border: 'none', borderRadius: '12px', color: 'white', fontSize: '1rem', outline: 'none', cursor: 'pointer' }}
                                >
                                    <option value="en">Inglés (English)</option>
                                    <option value="de">Alemán (Deutsch)</option>
                                    <option value="es">Español (Español)</option>
                                    <option value="fr">Francés (Français)</option>
                                </select>
                                <div style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'flex', alignItems: 'center', opacity: 0.6, color: '#fff' }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <button onClick={() => { setShowAddModal(false); setPdfFile(null); }} className="btn-secondary">Cancelar</button>
                            <button 
                                onClick={handleImportPdf} disabled={importingPdf} className="btn-primary"
                                style={{ opacity: importingPdf ? 0.6 : 1, cursor: importingPdf ? 'not-allowed' : 'pointer' }}
                            >
                                {importingPdf ? (pdfUploadProgress < 100 ? `Subiendo ${pdfUploadProgress}%...` : 'Procesando...') : 'Importar y Analizar'}
                            </button>
                        </div>
                    </>
                ) : (
                    /* TAB AUDIO */
                    <>
                        {uploadingAudio && (
                            <div style={{ marginBottom: '16px' }}>
                                <div style={{ fontSize: '0.85rem', color: theme.textSecondary, marginBottom: '6px', fontWeight: '500' }}>
                                    {uploadStatusMsg || `Subiendo audio... ${uploadProgress}%`}
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
                                        ? (audioFiles.length === 1 ? audioFiles[0].name : `${audioFiles.length} archivos seleccionados`)
                                        : "Selecciona tus archivos de audio"
                                    }
                                </div>
                                <div style={{ fontSize: '0.8rem', color: theme.textSecondary }}>
                                    {audioFiles.length > 0 
                                        ? `${(audioFiles.reduce((acc, f) => acc + f.size, 0) / 1024 / 1024).toFixed(1)} MB en total`
                                        : 'MP3, M4A, WAV, OGG — se sube a la nube (puedes seleccionar varios)'
                                    }
                                </div>
                            </label>
                        </div>

                        {audioFiles.length <= 1 && (
                            <input 
                                type="text" placeholder="Título del audiolibro" value={audioTitle}
                                onChange={e => setAudioTitle(e.target.value)}
                                style={{ width: '100%', padding: '16px', background: '#2C2C2E', border: 'none', borderRadius: '12px', color: 'white', marginBottom: '24px', fontSize: '1rem', outline: 'none' }}
                            />
                        )}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: audioFiles.length > 1 ? '16px' : '0' }}>
                            <button onClick={() => { setShowAddModal(false); setAudioFiles([]); setAudioTitle(''); }} className="btn-secondary">Cancelar</button>
                            <button 
                                onClick={handleUploadAudio} disabled={uploadingAudio || audioFiles.length === 0} className="btn-primary"
                                style={{ opacity: (uploadingAudio || audioFiles.length === 0) ? 0.6 : 1, cursor: (uploadingAudio || audioFiles.length === 0) ? 'not-allowed' : 'pointer', background: '#30D158' }}
                            >
                                {uploadingAudio 
                                    ? 'Subiendo... ☁' 
                                    : (audioFiles.length > 1 ? `Subir ${audioFiles.length} Audios ☁` : 'Subir Audio ☁')
                                }
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
      )}

      {/* MODAL PALABRA */}
      {selectedWord && (
          <>
            <div onClick={() => {
              if (Date.now() - modalOpenedTime.current > 400) {
                isPopupClosedByUser.current = true;
                setSelectedWord(null);
              }
            }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.1)', zIndex: 1100 }} />
            <div style={{ 
                position: 'fixed', bottom: 0, left: 0, right: 0, 
                backgroundColor: theme.modalBg, backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)',
                borderRadius: '24px 24px 0 0', padding: '30px 24px 50px 24px', zIndex: 1200, 
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
                            <button onClick={() => playWordAudio(selectedWord.word)} className="icon-btn" style={{ background: 'rgba(255,255,255,0.1)', padding: '8px', borderRadius: '50%' }}>
                                <SpeakerIcon />
                            </button>
                        </div>
                        {isLoading ? <span style={{ color: theme.accent, fontSize:'0.9rem' }}>Analizando...</span> : <span style={{ color: theme.textSecondary, fontSize:'0.9rem' }}>{selectedWord.grammar || "Vocabulario"}</span>}
                    </div>
                    <button onClick={() => { isPopupClosedByUser.current = true; setSelectedWord(null); }} className="icon-btn" style={{ margin: '-5px -5px 0 0' }}><CloseIconCircle /></button>
                </div>
                
                <div style={{ opacity: isLoading ? 0.5 : 1, transition: 'opacity 0.3s' }}>
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
                                    Pertenece a una frase subrayada
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
                                Ver frase
                            </button>
                        </div>
                    )}
                    {selectedWord.fromCache && (
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
                                    Traducción Guardada
                                </span>
                            </div>
                            <p style={{ margin: '0 0 4px 0', fontSize: '0.85rem', color: theme.textSecondary, lineHeight: '1.4' }}>
                                El significado puede variar según el contexto actual.
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
                                Re-analizar contexto 🔄
                            </button>
                        </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '25px' }}>
                        <div className="card-info"><div className="label">ESPAÑOL</div><div className="val">{selectedWord.es}</div></div>
                        <div className="card-info"><div className="label">ENGLISH</div><div className="val">{selectedWord.en}</div></div>
                    </div>
                    {selectedWord.alternatives && selectedWord.alternatives.length > 0 && (
                        <div style={{ 
                            background: 'rgba(255,255,255,0.04)', 
                            padding: '16px 20px', 
                            borderRadius: '16px', 
                            marginBottom: '25px',
                            border: '1px solid rgba(255,255,255,0.05)'
                        }}>
                            <div style={{ fontSize: '0.7rem', color: '#86868b', fontWeight: '700', marginBottom: '6px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                                Otras Acepciones / Alternativas
                            </div>
                            <div style={{ fontSize: '1.05rem', fontWeight: '600', color: '#fff' }}>
                                {selectedWord.alternatives.join(', ')}
                            </div>
                        </div>
                    )}
                    <div style={{ paddingLeft: '8px' }}>
                        <h3 style={{ fontSize: '0.8rem', color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>Contexto</h3>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                            {(selectedWord.examples || []).map((ex, i) => (
                                <li key={i} style={{ paddingLeft: '16px', borderLeft: `3px solid ${theme.accent}`, marginBottom: '16px' }}>
                                    <p style={{ margin: '0 0 6px 0', fontSize: '1.1rem', fontFamily: '"New York", serif', color: '#E5E5E7', fontStyle: 'italic' }}>"{typeof ex === 'string' ? ex : ex.original}"</p>
                                    {(typeof ex === 'object' && ex.es_translation) && <p style={{ margin: 0, fontSize: '0.9rem', color: '#86868b' }}>{ex.es_translation}</p>}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>
          </>
      )}

      <style>{`
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
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