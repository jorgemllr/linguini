from flask import Flask, request, jsonify
from flask_cors import CORS
from openai import OpenAI
import os

app = Flask(__name__)
# Permitimos CORS desde cualquier origen para evitar problemas en Vercel
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Vercel inyecta la variable automáticamente, no hace falta cargar .env
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Ruta de prueba para ver si el backend vive
@app.route('/api/hello', methods=['GET'])
def hello():
    return jsonify({"message": "Hello from Vercel Python!"})

@app.route('/api/analyze', methods=['POST'])
def analyze_word():
    data = request.json
    word = data.get('word')
    context_sentence = data.get('context')
    
    print(f"🤖 Vercel Copilot analizando: {word}...")

    prompt = f"""
    Actúa como un profesor de alemán experto. El usuario no entiende "{word}".
    Contexto: "...{context_sentence}..."
    Analiza "{word}" EN ESE CONTEXTO y devuelve JSON con:
    1. "es": Traducción español.
    2. "en": Traducción inglés.
    3. "grammar": Explicación gramatical breve.
    4. "examples": Array con 2 objetos {{"original": "...", "es_translation": "..."}}.
    """

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "You are a language tutor. Output JSON."},
                {"role": "user", "content": prompt}
            ]
        )
        return response.choices[0].message.content, 200, {'Content-Type': 'application/json'}
    except Exception as e:
        return jsonify({"error": str(e)}), 500