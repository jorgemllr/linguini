import os
import json
from faster_whisper import WhisperModel
from openai import OpenAI
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

# =========================
# Configuración
# =========================
MODEL_SIZE = "small"
AUDIO_FILE = "podcast.mp3"  # <--- Asegúrate que tu archivo se llame así

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Inicializar Whisper (se carga una sola vez en memoria)
whisper_model = WhisperModel(
    MODEL_SIZE,
    device="cpu",        # En Mac M1, "cpu" con "int8" suele ser lo más estable/rápido
    compute_type="int8"
)

# =========================
# 1. Transcripción
# =========================
def transcribe_audio(file_path: str) -> tuple[str, str]:
    print("🎧 Transcribiendo audio...")
    segments, info = whisper_model.transcribe(file_path, beam_size=5)
    
    # Unimos todos los segmentos en un solo texto gigante
    full_text = " ".join(segment.text for segment in segments)
    
    return full_text.strip(), info.language

# =========================
# 2. Análisis Lingüístico (Con Filtro Anti-Duplicados)
# =========================
def analyze_vocabulary(text: str, language: str) -> dict:
    print(f"🧠 Analizando vocabulario ({language})...")

    # Solicitud a OpenAI con "Strict Mode" para asegurar estructura perfecta
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "vocabulary_analysis",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": {
                        "vocabulary": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "word": {"type": "string"},
                                    "es": {"type": "string"},
                                    "en": {"type": "string"},
                                    "examples": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "original": {"type": "string"},
                                                "es_translation": {"type": "string"}
                                            },
                                            "required": ["original", "es_translation"],
                                            "additionalProperties": False
                                        },
                                        "minItems": 1,
                                        "maxItems": 2
                                    }
                                },
                                "required": ["word", "es", "en", "examples"],
                                "additionalProperties": False
                            }
                        }
                    },
                    "required": ["vocabulary"],
                    "additionalProperties": False
                }
            }
        },
        messages=[
            {
                "role": "system",
                "content": "Eres un profesor de idiomas experto. Tu tarea es extraer vocabulario clave (Niveles B1-C2) y SIEMPRE generar ejemplos de uso con su traducción."
            },
            {
                "role": "user",
                "content": f"""
Analiza el siguiente texto en idioma '{language}'.
Extrae las palabras más importantes y difíciles.

PARA CADA PALABRA ES OBLIGATORIO INCLUIR:
1. Traducción al español.
2. Traducción al inglés.
3. Una lista 'examples' con 1 o 2 frases de ejemplo. Cada ejemplo debe tener:
   - "original": La frase en el idioma original.
   - "es_translation": La traducción de esa frase al español.

Texto:
{text}
"""
            }
        ]
    )

    # Obtenemos el JSON crudo de la IA
    data = json.loads(response.choices[0].message.content)

    # --- LÓGICA ANTI-DUPLICADOS ---
    # Esto limpia el resultado para que no tengas la misma palabra 2 veces
    unique_vocab = []
    seen_words = set()

    print("🧹 Limpiando duplicados...")
    for item in data['vocabulary']:
        # Normalizamos la palabra (minúsculas y sin espacios extra)
        word_clean = item['word'].lower().strip()
        
        # Si no la hemos visto antes, la agregamos
        if word_clean not in seen_words:
            unique_vocab.append(item)
            seen_words.add(word_clean)

    # Devolvemos el diccionario limpio
    return {"vocabulary": unique_vocab}

# =========================
# Ejecución Principal
# =========================
def main():
    # Paso A: Transcribir
    text, lang = transcribe_audio(AUDIO_FILE)
    
    # --- GUARDA EL TEXTO PLANO ---
    # Este archivo 'transcript.txt' es el que leerá tu App.jsx con '?raw'
    with open("transcript.txt", "w", encoding="utf-8") as f:
        f.write(text)
    print("📄 transcript.txt generado (Contiene el texto completo).")

    # Paso B: Analizar con IA
    analysis = analyze_vocabulary(text, lang)

    # --- GUARDA LOS DATOS JSON ---
    # Ya NO incluimos 'full_text' aquí para que el archivo sea ligero
    final_data = {
        "language": lang,
        "analysis": analysis
    }

    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(final_data, f, ensure_ascii=False, indent=4)

    print("✅ data.json generado (Contiene solo el vocabulario inteligente).")
    print("\n⚠️  IMPORTANTE: Ahora mueve 'transcript.txt' y 'data.json' a la carpeta 'frontend/src/'")

if __name__ == "__main__":
    main()