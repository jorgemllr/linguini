import React, { useState, useRef, useEffect } from 'react';

// 1. IMPORTAMOS EL CEREBRO (Vocabulario y traducciones locales)
import data from './data.json';

// 2. IMPORTAMOS EL TEXTO GIGANTE (Optimización)
// Usamos '?raw' para importar el texto plano sin ensuciar el código
import rawTranscript from './transcript.txt?raw';

// --- ICONOS SVG MINIMALISTAS ---
const PlayIcon = () => (
  <svg width="42" height="42" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
);
const PauseIcon = () => (
  <svg width="42" height="42" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
);
const BackIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
);
const ForwardIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
);
const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
);

function App() {
  const [selectedWord, setSelectedWord] = useState(null);
  const [isLoading, setIsLoading] = useState(false); // Estado para saber si Copilot está pensando
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  
  // Usamos el texto importado del archivo .txt
  const fullText = rawTranscript;

  const audioRef = useRef(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => setDuration(audio.duration);
    const onEnded = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  const togglePlay = () => {
    if (audioRef.current.paused) {
      audioRef.current.play();
      setIsPlaying(true);
    } else {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  };

  const skipTime = (seconds) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.min(Math.max(audioRef.current.currentTime + seconds, 0), duration);
    }
  };

  const handleSeek = (e) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    audioRef.current.currentTime = newTime;
  };

  // === LÓGICA INTELIGENTE (HÍBRIDA) ===
  const handleWordClick = async (clickedWord, surroundingSentence) => {
    const cleanWord = clickedWord.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
    
    // 1. Intentamos buscar en el JSON local (Modo Rápido/Offline)
    const localInfo = data.analysis.vocabulary.find(v => v.word.toLowerCase() === cleanWord.toLowerCase());
    
    if (localInfo) {
      setSelectedWord(localInfo);
      return;
    }

    // 2. Si no está, preguntamos al Copilot (Modo Online/Flask)
    setIsLoading(true);
    setSelectedWord({ word: cleanWord, es: "...", en: "...", examples: [] });

    // DETECCIÓN AUTOMÁTICA DE ENTORNO
    // import.meta.env.DEV es true cuando corres 'npm run dev' en tu casa
    const API_URL = import.meta.env.DEV 
        ? 'http://localhost:5000/api/analyze' 
        : '/api/analyze'; 

    try {
      const response = await fetch(API_URL, {  // <--- Usamos la variable aquí
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          word: cleanWord,
          context: surroundingSentence 
        })
      });
      
      const apiData = await response.json();
      
      // Actualizamos con la info de la IA
      setSelectedWord({
        word: cleanWord,
        es: apiData.es,
        en: apiData.en,
        grammar: apiData.grammar,
        examples: apiData.examples
      });
      
    } catch (error) {
      console.error("Error conectando con Copilot:", error);
      alert("No se pudo conectar con el servidor Python (asegúrate de correr 'python app.py')");
      setSelectedWord(null);
    } finally {
      setIsLoading(false);
    }
  };

  // Función auxiliar para extraer el contexto (frase) alrededor de la palabra clicada
  const getContextSentence = (text, index) => {
      const words = text.split(' ');
      // Tomamos 8 palabras atrás y 8 adelante para dar contexto a la IA
      const start = Math.max(0, index - 8);
      const end = Math.min(words.length, index + 8);
      return words.slice(start, end).join(' ');
  };

  const formatTime = (time) => {
    if (isNaN(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  // --- COLORES DEL TEMA OSCURO ---
  const theme = {
    bg: '#111111',
    text: '#E5E5E7',
    textSecondary: '#86868b',
    headerBg: 'rgba(17, 17, 17, 0.85)',
    highlightBg: 'rgba(255, 179, 64, 0.2)',
    highlightText: '#FFD60A',
    highlightBorder: 'rgba(255, 214, 10, 0.3)',
    modalBg: '#1C1C1E',
    cardBg: '#2C2C2E',
    accent: '#0A84FF'
  };

  return (
    <div style={{ 
      backgroundColor: theme.bg,
      minHeight: '100vh', 
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif',
      color: theme.text,
      paddingBottom: '220px',
      transition: 'background-color 0.3s ease'
    }}>
      
      {/* HEADER */}
      <header style={{ position: 'sticky', top: 0, zIndex: 50, backgroundColor: theme.headerBg, backdropFilter: 'blur(20px)', padding: '15px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
         <h1 style={{ fontSize: '0.8rem', margin: 0, color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '600' }}>
          {data.language === 'de' ? '🇩🇪 Deutsch' : data.language.toUpperCase()} • {data.analysis.vocabulary.length} palabras clave
        </h1>
      </header>

      {/* TEXTO PRINCIPAL */}
      <div className="responsive-container" style={{ margin: '0 auto', padding: '20px 24px' }}>
        <p style={{ fontSize: '1.4rem', lineHeight: '1.7', fontFamily: '"New York", "Georgia", serif', textAlign: 'justify', color: theme.text }}>
          {fullText.split(' ').map((word, index) => {
             const clean = word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").toLowerCase();
             // Checamos si es palabra "difícil" (amarilla)
             const isHard = data.analysis.vocabulary.some(v => v.word.toLowerCase() === clean);
             
             return (
              <span key={index} 
                // Al hacer clic, enviamos la palabra Y SU CONTEXTO
                onClick={() => handleWordClick(word, getContextSentence(fullText, index))}
                style={{ 
                    display: 'inline-block', 
                    marginRight: '5px', 
                    cursor: 'pointer', 
                    backgroundColor: isHard ? theme.highlightBg : 'transparent', 
                    color: isHard ? theme.highlightText : 'inherit', // Si no es hard, hereda el color normal
                    fontWeight: isHard ? '500' : '400', 
                    borderRadius: '6px', 
                    padding: isHard ? '0 4px' : '0', 
                    transition: 'all 0.2s', 
                    borderBottom: isHard ? `1px solid ${theme.highlightBorder}` : 'none' 
                }}
                // Efecto hover para que el usuario sepa que puede clicar cualquier palabra
                onMouseOver={(e) => { if(!isHard) e.currentTarget.style.textDecoration = 'underline dotted #666'; }}
                onMouseOut={(e) => { if(!isHard) e.currentTarget.style.textDecoration = 'none'; }}
              >
                {word}
              </span>
             );
          })}
        </p>
      </div>

      {/* REPRODUCTOR FLOTANTE */}
      <div style={{
        position: 'fixed', bottom: '30px', left: '20px', right: '20px', maxWidth: '500px', margin: '0 auto',
        backgroundColor: '#1C1C1E', 
        backdropFilter: 'blur(25px)', WebkitBackdropFilter: 'blur(25px)',
        borderRadius: '24px', padding: '20px 24px', zIndex: 1000, color: 'white',
        boxShadow: '0 20px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
           <div style={{ fontSize: '1rem', fontWeight: '600', letterSpacing: '0.3px' }}>Podcast Episode</div>
           <div style={{ fontSize: '0.8rem', color: '#86868b', marginTop: '2px' }}>{data.language.toUpperCase()} Listening</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
           <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.75rem', color: '#86868b', fontVariantNumeric: 'tabular-nums' }}>
             <span>{formatTime(currentTime)}</span>
             <div style={{ position: 'relative', flexGrow: 1, height: '20px', display: 'flex', alignItems: 'center' }}>
               <input type="range" min="0" max={duration || 0} value={currentTime} onChange={handleSeek}
                 style={{ width: '100%', height: '4px', borderRadius: '2px', appearance: 'none', background: `linear-gradient(to right, #ffffff ${duration ? (currentTime/duration)*100 : 0}%, #48484a 0%)`, outline: 'none', cursor: 'pointer', margin: 0 }} />
             </div>
             <span>{formatTime(duration)}</span>
           </div>
           <div style={{ display: 'flex', justifyContent: 'space-evenly', alignItems: 'center', padding: '0 10px' }}>
             <button onClick={() => skipTime(-5)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', flexDirection: 'row', alignItems: 'center', opacity: 0.9, padding: '0 10px', gap: '8px', outline: 'none' }}><span style={{ fontSize: '0.75rem', fontWeight: '500', color: '#86868b' }}>-5s</span><BackIcon /></button>
             <button onClick={togglePlay} style={{ background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: 'pointer', padding: '0 20px', transition: 'transform 0.1s', outline: 'none' }} onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.9)'} onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}>{isPlaying ? <PauseIcon /> : <PlayIcon />}</button>
             <button onClick={() => skipTime(5)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', flexDirection: 'row', alignItems: 'center', opacity: 0.9, padding: '0 10px', gap: '8px', outline: 'none' }}><ForwardIcon /><span style={{ fontSize: '0.75rem', fontWeight: '500', color: '#86868b' }}>+5s</span></button>
           </div>
        </div>
        <audio ref={audioRef} src="/podcast.mp3" preload="metadata" />
      </div>

      {/* === MODAL INTELIGENTE === */}
      {selectedWord && (
        <>
          <div onClick={() => setSelectedWord(null)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 1100 }} />
          <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, backgroundColor: theme.modalBg, borderRadius: '24px 24px 0 0', padding: '30px 24px 50px 24px', zIndex: 1200, boxShadow: '0 -10px 60px rgba(0,0,0,0.5)', animation: 'slideUp 0.35s cubic-bezier(0.32, 0.72, 0, 1)', maxHeight: '80vh', overflowY: 'auto' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
              <div>
                <h2 style={{ margin: '0 0 6px 0', fontSize: '2.2rem', fontFamily: '"New York", serif', fontWeight: '700', letterSpacing: '-0.02em', color: '#fff' }}>{selectedWord.word}</h2>
                
                {/* Indicador de carga o Gramática */}
                {isLoading ? (
                    <span style={{ fontSize: '0.9rem', color: theme.accent, fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className="pulse">●</span> Analizando con IA...
                    </span>
                ) : (
                    <span style={{ fontSize: '0.9rem', color: theme.textSecondary, fontWeight: '500' }}>
                        {selectedWord.grammar || "Traducción rápida"}
                    </span>
                )}

              </div>
              <button onClick={() => setSelectedWord(null)} style={{ background: '#3A3A3C', border: 'none', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: 'pointer', padding: 0, outline: 'none' }}><CloseIcon /></button>
            </div>
            
            {/* Contenido (se opaca si está cargando) */}
            <div style={{ opacity: isLoading ? 0.3 : 1, transition: 'opacity 0.3s', pointerEvents: isLoading ? 'none' : 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '30px' }}>
                  <div style={{ background: theme.cardBg, padding: '16px', borderRadius: '16px' }}><div style={{ fontSize: '0.7rem', color: theme.textSecondary, fontWeight: '700', marginBottom: '6px', textTransform: 'uppercase' }}>Español</div><div style={{ fontSize: '1.2rem', fontWeight: '600', color: '#fff' }}>{selectedWord.es}</div></div>
                  <div style={{ background: theme.cardBg, padding: '16px', borderRadius: '16px' }}><div style={{ fontSize: '0.7rem', color: theme.textSecondary, fontWeight: '700', marginBottom: '6px', textTransform: 'uppercase' }}>English</div><div style={{ fontSize: '1.2rem', fontWeight: '600', color: '#fff' }}>{selectedWord.en}</div></div>
                </div>
                
                <h3 style={{ fontSize: '0.8rem', color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600', marginBottom: '16px' }}>En Contexto</h3>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {(selectedWord.examples || []).map((ex, i) => {
                      const text = typeof ex === 'string' ? ex : ex.original;
                      const translation = (typeof ex === 'object' && ex.es_translation) ? ex.es_translation : null;
                      return (
                        <li key={i} style={{ paddingLeft: '16px', borderLeft: '3px solid #0071e3', marginBottom: '12px' }}>
                          <p style={{ margin: '0 0 4px 0', fontSize: '1.1rem', fontFamily: '"New York", serif', color: '#E5E5E7', lineHeight: '1.4', fontStyle: 'italic' }}>"{text}"</p>
                          {translation && (<p style={{ margin: 0, fontSize: '0.9rem', color: '#86868b' }}>→ {translation}</p>)}
                        </li>
                      );
                  })}
                  {(!selectedWord.examples || selectedWord.examples.length === 0) && !isLoading && (
                      <li style={{ color: '#888', fontStyle: 'italic' }}>No hay ejemplos disponibles.</li>
                  )}
                </ul>
            </div>

          </div>
        </>
      )}

      <style>{`
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes pulse { 0% { opacity: 0.3; } 50% { opacity: 1; } 100% { opacity: 0.3; } }
        .pulse { animation: pulse 1s infinite ease-in-out; color: #0A84FF; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; height: 12px; width: 12px; border-radius: 50%; background: #ffffff; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.4); margin-top: -4px; }
        input[type=range]::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; }
        .responsive-container { max-width: 680px; }
        @media (min-width: 768px) { .responsive-container { max-width: 900px; padding-top: 40px; } }
      `}</style>
    </div>
  );
}

export default App;