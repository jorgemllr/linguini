import os
from dotenv import load_dotenv
from openai import OpenAI

# Cargar .env
dotenv_paths = [".env", "frontend/.env", "api/.env"]
for path in dotenv_paths:
    if os.path.exists(path):
        load_dotenv(dotenv_path=path)
        break
else:
    load_dotenv()

def main():
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("❌ ERROR: No se encontró la variable OPENAI_API_KEY en el archivo .env")
        return

    client = OpenAI(api_key=api_key)
    audio_file = "AE2_LE_piste026.mp3"
    output_file = "AE2_LE_piste026.txt"

    if not os.path.exists(audio_file):
        print(f"❌ ERROR: No se encuentra el archivo {audio_file} en este directorio.")
        return

    print(f"🎧 Transcribiendo {audio_file} en la nube (Idioma: Francés)...")
    try:
        with open(audio_file, "rb") as f:
            transcription = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                language="fr"
            )
        
        text = transcription.text
        print("\n✨ Transcripción exitosa:")
        print("-" * 50)
        print(text)
        print("-" * 50)
        
        with open(output_file, "w", encoding="utf-8") as out_f:
            out_f.write(text)
        print(f"💾 Guardado en: {output_file}")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    main()
