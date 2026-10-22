import os
from dotenv import load_dotenv
from openai import OpenAI

# Intentar cargar .env desde múltiples rutas posibles
dotenv_paths = [".env", "frontend/.env", "api/.env"]
for path in dotenv_paths:
    if os.path.exists(path):
        load_dotenv(dotenv_path=path)
        break
else:
    load_dotenv()

def find_file(possible_names):
    for name in possible_names:
        if os.path.exists(name):
            return name
    return None

def main():
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("❌ ERROR: No se encontró la variable OPENAI_API_KEY en el archivo .env")
        return

    print("🔌 Conectando con la API de OpenAI...")
    client = OpenAI(api_key=api_key)

    # Candidatos para audio 1 y audio 2 en formato MP3
    audio1_candidates = ["audio1.mp3", "audio 1.mp3"]
    audio2_candidates = ["audio2.mp3", "audio 2.mp3"]
    
    file1 = find_file(audio1_candidates)
    file2 = find_file(audio2_candidates)
    
    tasks = [
        (file1, "transcripcion1.txt", "Audio 1"),
        (file2, "transcripcion2.txt", "Audio 2")
    ]
    
    for audio_file, output_file, label in tasks:
        if not audio_file:
            print(f"⚠️ No se encontró el archivo para {label}. Asegúrate de tener 'audio1.mp3' o 'audio2.mp3' en este directorio.")
            continue
            
        print(f"\n🎧 Transcribiendo {label} ({audio_file}) en la nube...")
        print("⏳ Subiendo el archivo y esperando respuesta de OpenAI (suele tardar de 5 a 15 segundos)...")
        try:
            with open(audio_file, "rb") as f:
                transcription = client.audio.transcriptions.create(
                    model="whisper-1",
                    file=f
                )
            
            text = transcription.text
            print(f"✨ Transcripción exitosa para {label}:")
            print("-" * 40)
            print(text)
            print("-" * 40)
            
            # Guardar en archivo txt
            with open(output_file, "w", encoding="utf-8") as out_f:
                out_f.write(text)
            print(f"💾 Transcripción guardada en: {output_file}")
        except Exception as e:
            print(f"❌ Error al transcribir {label}: {e}")
            
    print("\nProceso terminado.")

if __name__ == "__main__":
    main()
