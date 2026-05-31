import os
import json
from faster_whisper import WhisperModel
from openai import OpenAI
from dotenv import load_dotenv
from supabase import create_client, Client

# =========================
# Configuración Inicial
# =========================
load_dotenv(dotenv_path='frontend/.env')

MODEL_SIZE = "small"
AUDIO_FILE = "podcast.mp3" 

# Configuración de Rutas de Salida (AUTOMATIZACIÓN)
# Esto guarda los archivos directamente en la carpeta del frontend
OUTPUT_DIR = os.path.join("frontend", "src")
os.makedirs(OUTPUT_DIR, exist_ok=True) # Crea la carpeta si no existe

# Validar Claves
openai_key = os.getenv("OPENAI_API_KEY")
supabase_url = os.getenv("VITE_SUPABASE_URL")
supabase_key = os.getenv("VITE_SUPABASE_ANON_KEY")

if not openai_key:
    print("❌ ERROR CRÍTICO: No se encontró OPENAI_API_KEY.")
    exit()

client = OpenAI(api_key=openai_key)
supabase: Client = create_client(supabase_url, supabase_key) if supabase_url and supabase_key else None

whisper_model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")

# =========================
# 1. Transcripción
# =========================
def transcribe_audio(file_path: str) -> tuple[str, str]:
    print(f"🎧 Transcribiendo '{file_path}'...")
    if not os.path.exists(file_path):
        print(f"❌ Error: No encuentro el archivo {file_path}")
        exit()

    segments, info = whisper_model.transcribe(file_path, beam_size=5)
    full_text = " ".join(segment.text for segment in segments)
    return full_text.strip(), info.language

# =========================
# 2. Análisis Lingüístico
# =========================
def analyze_vocabulary(text: str, language: str) -> dict:
    print(f"🧠 Analizando vocabulario ({language})...")

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
            {"role": "system", "content": "Eres un profesor experto. Extrae vocabulario B1-C2."},
            {"role": "user", "content": f"Analiza este texto en '{language}'. Extrae palabras clave con traducciones y ejemplos:\n{text}"}
        ]
    )

    data = json.loads(response.choices[0].message.content)
    unique_vocab = []
    seen_words = set()

    print("🧹 Limpiando duplicados...")
    for item in data['vocabulary']:
        word_clean = item['word'].lower().strip()
        if word_clean not in seen_words:
            unique_vocab.append(item)
            seen_words.add(word_clean)

    return {"vocabulary": unique_vocab}

# =========================
# 3. Subida a Supabase
# =========================
def upload_to_supabase(vocab_list, language):
    if not supabase:
        return

    print(f"🚀 Subiendo {len(vocab_list)} palabras a Supabase...")
    count = 0
    for item in vocab_list:
        try:
            word_key = item['word'].strip().lower()
            payload = { "word": word_key, "language": language, "translation_data": item }
            supabase.table('word_cache').upsert(payload, on_conflict='word, language').execute()
            count += 1
        except Exception as e:
            print(f"⚠️ Error subiendo '{item['word']}': {e}")
            
    print(f"🎉 Sincronización completada: {count} palabras.")

# =========================
# Ejecución Principal
# =========================
def main():
    text, lang = transcribe_audio(AUDIO_FILE)
    
    # GUARDAR DIRECTAMENTE EN FRONTEND/SRC
    transcript_path = os.path.join(OUTPUT_DIR, "transcript.txt")
    with open(transcript_path, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"📄 Guardado: {transcript_path}")

    analysis = analyze_vocabulary(text, lang)
    
    final_data = { "language": lang, "analysis": analysis }
    json_path = os.path.join(OUTPUT_DIR, "data.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(final_data, f, ensure_ascii=False, indent=4)
    print(f"✅ Guardado: {json_path}")

    vocab_list = analysis.get("vocabulary", [])
    if len(vocab_list) > 0:
        upload_to_supabase(vocab_list, lang)

if __name__ == "__main__":
    main()