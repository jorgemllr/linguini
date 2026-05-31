from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import os
from dotenv import load_dotenv
from pathlib import Path
import uuid
from database import init_db, get_all_documents, insert_document, get_cached_word, insert_cached_word, delete_cached_word, update_document, update_document_progress

# --- CONFIGURACIÓN DE RUTAS LOCALES (OBSIDIAN) ---
OBSIDIAN_VAULT_DIR = Path("/Users/book/Documents/Zentralnervensystem")
BOOKS_DIR = OBSIDIAN_VAULT_DIR / "Books"
AUDIOBOOKS_DIR = OBSIDIAN_VAULT_DIR / "Audiobooks"

# Nos aseguramos de que existan
os.makedirs(BOOKS_DIR, exist_ok=True)
os.makedirs(AUDIOBOOKS_DIR, exist_ok=True)

# ==========================================
# CONFIGURACIÓN PARA LOCAL (Cargar .env)
# ==========================================
env_path = Path(__file__).resolve().parent.parent / 'frontend' / '.env'
load_dotenv(dotenv_path=env_path)

# Por si acaso, intentamos cargar también desde la raíz si falló lo anterior
if not os.getenv("OPENAI_API_KEY") and not os.getenv("GEMINI_API_KEY"):
    load_dotenv()

app = Flask(__name__)
# Permitimos CORS desde cualquier origen para evitar problemas en Vercel
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Inicializamos la base de datos local SQLite
init_db()

_openai_client = None
_gemini_client = None

def get_openai_client():
    global _openai_client
    if _openai_client is None:
        openai_api_key = os.getenv("OPENAI_API_KEY")
        if openai_api_key:
            try:
                from openai import OpenAI
                _openai_client = OpenAI(api_key=openai_api_key)
            except Exception as e:
                print(f"❌ Error al inicializar cliente de OpenAI: {e}")
    return _openai_client

def get_gemini_client():
    global _gemini_client
    if _gemini_client is None:
        gemini_api_key = os.getenv("GEMINI_API_KEY")
        if gemini_api_key:
            try:
                from google import genai
                _gemini_client = genai.Client(api_key=gemini_api_key)
            except Exception as e:
                print(f"❌ Error al inicializar cliente de Gemini: {e}")
    return _gemini_client

# Ruta de prueba para ver si el backend vive
@app.route('/api/hello', methods=['GET'])
def hello():
    return jsonify({"message": "Hello from Vercel Python!"})

# --- ENDPOINTS BASE DE DATOS LOCAL (REPLAZA SUPABASE) ---

@app.route('/api/documents', methods=['GET'])
def get_documents():
    try:
        docs = get_all_documents()
        return jsonify(docs)
    except Exception as e:
        print(f"❌ Error al consultar documentos: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/documents', methods=['POST'])
def save_document():
    try:
        data = request.json
        doc_id = data.get('id') or str(uuid.uuid4())
        title = data.get('title')
        content = data.get('content')
        language = data.get('language', 'auto')
        audio_url = data.get('audio_url')
        
        if not title or not content:
            return jsonify({"error": "Faltan título o contenido."}), 400
            
        doc = insert_document(doc_id, title, content, language, audio_url)
        return jsonify(doc)
    except Exception as e:
        print(f"❌ Error al guardar documento: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/documents/<doc_id>', methods=['PUT'])
def update_document_route(doc_id):
    try:
        data = request.json
        content = data.get('content')
        if not content:
            return jsonify({"error": "Falta parámetro 'content'."}), 400
            
        result = update_document(doc_id, content)
        return jsonify(result)
    except Exception as e:
        print(f"❌ Error al actualizar documento: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/documents/<doc_id>/progress', methods=['PUT'])
def update_document_progress_route(doc_id):
    try:
        data = request.json
        current_page = data.get('current_page')
        scroll_position = data.get('scroll_position')
        
        if current_page is None or scroll_position is None:
            return jsonify({"error": "Faltan parámetros 'current_page' o 'scroll_position'."}), 400
            
        result = update_document_progress(doc_id, int(current_page), float(scroll_position))
        return jsonify(result)
    except Exception as e:
        print(f"❌ Error al actualizar progreso de documento: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/word_cache', methods=['GET'])
def query_word_cache():
    word = request.args.get('word')
    language = request.args.get('language', 'auto')
    
    if not word:
        return jsonify({"error": "Falta parámetro 'word'."}), 400
        
    try:
        cached = get_cached_word(word, language)
        if cached:
            return jsonify(cached)
        return jsonify(None) # Devuelve null si no existe, igual que supabase .maybeSingle()
    except Exception as e:
        print(f"❌ Error al consultar palabra: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/word_cache', methods=['POST'])
def save_word_cache():
    try:
        data = request.json
        word = data.get('word')
        language = data.get('language')
        translation_data = data.get('translation_data')
        
        if not word or not language or not translation_data:
            return jsonify({"error": "Faltan datos de palabra, idioma o traducción."}), 400
            
        result = insert_cached_word(word, language, translation_data)
        return jsonify(result)
    except Exception as e:
        print(f"❌ Error al guardar palabra en caché: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/word_cache', methods=['DELETE'])
def remove_word_cache():
    try:
        word = request.args.get('word')
        language = request.args.get('language')
        
        if not word or not language:
            return jsonify({"error": "Faltan parámetros 'word' o 'language'."}), 400
            
        result = delete_cached_word(word, language)
        return jsonify(result)
    except Exception as e:
        print(f"❌ Error al eliminar palabra de la caché: {e}")
        return jsonify({"error": str(e)}), 500

# --- ENDPOINTS SYNCTHING / OBSIDIAN LOCAL FILE SCANNING ---

@app.route('/api/local-files', methods=['GET'])
def list_local_files():
    try:
        import glob
        # 1. Obtener PDFs disponibles en Books/
        pdf_paths = glob.glob(str(BOOKS_DIR / "*.pdf"))
        pdfs = [os.path.basename(p) for p in pdf_paths]
        
        # 2. Obtener audiolibros disponibles en Audiobooks/
        audio_extensions = ["*.mp3", "*.m4a", "*.wav", "*.ogg"]
        audio_files = []
        for ext in audio_extensions:
            audio_paths = glob.glob(str(AUDIOBOOKS_DIR / ext))
            audio_files.extend([os.path.basename(p) for p in audio_paths])
            
        # 3. Filtrar cuáles PDFs ya han sido procesados y guardados en Supabase
        docs = get_all_documents()
        processed_titles = {d["title"] for d in docs}
        
        unprocessed_pdfs = []
        for pdf in pdfs:
            doc_title = f"Subrayados: {pdf}"
            if doc_title not in processed_titles:
                unprocessed_pdfs.append(pdf)
                
        return jsonify({
            "unprocessed_pdfs": sorted(unprocessed_pdfs),
            "audiobooks": sorted(list(set(audio_files)))
        })
    except Exception as e:
        print(f"❌ Error al listar archivos locales: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/process-local-pdf', methods=['POST'])
def process_local_pdf():
    import fitz
    try:
        data = request.json
        filename = data.get('filename')
        language = data.get('language', 'en') # Por defecto inglés
        
        if not filename:
            return jsonify({"error": "Falta parámetro 'filename'."}), 400
            
        pdf_path = BOOKS_DIR / filename
        if not pdf_path.exists():
            return jsonify({"error": f"El archivo {filename} no existe en la carpeta Books."}), 404
            
        print(f"📖 Procesando libro localmente a petición del usuario: {filename}...")
        
        doc = fitz.open(str(pdf_path))
        
        highlights = []
        seen_words = set()
        full_text_pages = []
        
        for page_num in range(len(doc)):
            page = doc[page_num]
            
            # 1. Extraer texto estructurado por páginas y párrafos
            blocks = page.get_text("blocks")
            blocks.sort(key=lambda b: (b[1], b[0]))
            
            page_paragraphs = []
            for b in blocks:
                if b[6] == 0:
                    paragraph_text = b[4].replace('\n', ' ').strip()
                    if paragraph_text:
                        page_paragraphs.append(paragraph_text)
                        
            if page_paragraphs:
                page_content = f"<!-- PAGE {page_num + 1} -->\n" + "\n\n".join(page_paragraphs)
                full_text_pages.append(page_content)
                
            # 2. Extraer subrayados con alta precisión
            annots = page.annots()
            if not annots:
                continue
                
            page_words = page.get_text("words")
            for annot in annots:
                annot_type = annot.type[1].lower() if len(annot.type) > 1 else ""
                if annot_type in ["highlight", "underline"] or annot.type[0] in [8, 9]:
                    rect = annot.rect
                    
                    intersecting_words = []
                    for w in page_words:
                        word_rect = fitz.Rect(w[:4])
                        if word_rect.intersects(rect):
                            overlap = word_rect & rect
                            overlap_area = overlap.width * overlap.height if not overlap.is_empty else 0
                            word_area = word_rect.width * word_rect.height
                            overlap_ratio = overlap_area / word_area if word_area > 0 else 0
                            if overlap_ratio >= 0.4:
                                intersecting_words.append(w)
                                
                    if not intersecting_words:
                        continue
                        
                    if len(intersecting_words) > 3:
                        continue
                        
                    intersecting_words.sort(key=lambda x: (x[6], x[0]))
                    highlighted_text = " ".join([w[4] for w in intersecting_words])
                    clean_word = highlighted_text.strip(".,/#!$%^&*;:{}=-_`~()[]¿?¡!«»\"'")
                    if not clean_word:
                        continue
                        
                    word_key = clean_word.lower()
                    if word_key in seen_words:
                        continue
                    seen_words.add(word_key)
                    
                    first_word_block = intersecting_words[0][5]
                    context = ""
                    for b in blocks:
                        if b[5] == first_word_block:
                            context = b[4].replace('\n', ' ').strip()
                            break
                    if not context:
                        context = highlighted_text
                        
                    highlights.append({
                        "word": clean_word,
                        "context": context,
                        "page": page_num + 1
                    })
                    
        doc.close()
        
        # Formato final con metadatos
        words_list = ", ".join([h["word"] for h in highlights])
        final_content = "\n\n".join(full_text_pages) + "\n---\n" + words_list
        
        # Guardar en SQLite
        doc_id = str(uuid.uuid4())
        doc_title = f"Subrayados: {filename}"
        
        doc = insert_document(doc_id, doc_title, final_content, language)
        
        print(f"✅ Libro local procesado e importado con éxito: {filename} ({len(highlights)} subrayados)")
        return jsonify(doc)
    except Exception as e:
        print(f"❌ Error al procesar libro local: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/audiobooks/<path:filename>', methods=['GET'])
def get_audiobook_file(filename):
    try:
        return send_from_directory(str(AUDIOBOOKS_DIR), filename)
    except Exception as e:
        print(f"❌ Error al servir archivo de audio: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/import-pdf', methods=['POST'])
def import_pdf():
    import fitz
    if 'file' not in request.files:
        return jsonify({"error": "No se subió ningún archivo PDF."}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "Nombre de archivo vacío."}), 400
        
    try:
        pdf_bytes = file.read()
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        
        highlights = []
        seen_words = set()
        full_text_pages = []
        
        for page_num in range(len(doc)):
            page = doc[page_num]
            
            # --- 1. EXTRACCIÓN DE TEXTO COMPLETO ESTRUCTURADO ---
            blocks = page.get_text("blocks")
            # Ordenamos por coordenadas: arriba a abajo, izquierda a derecha
            blocks.sort(key=lambda b: (b[1], b[0]))
            
            page_paragraphs = []
            for b in blocks:
                if b[6] == 0: # Bloque de texto
                    paragraph_text = b[4].replace('\n', ' ').strip()
                    if paragraph_text:
                        page_paragraphs.append(paragraph_text)
            
            if page_paragraphs:
                page_content = f"<!-- PAGE {page_num + 1} -->\n" + "\n\n".join(page_paragraphs)
                full_text_pages.append(page_content)
                
            # --- 2. EXTRACCIÓN DE SUBRAYADOS Y ORACIONES CONTEXTUALES ---
            annots = page.annots()
            if not annots:
                continue
                
            page_words = page.get_text("words")
            
            for annot in annots:
                annot_type = annot.type[1].lower() if len(annot.type) > 1 else ""
                if annot_type in ["highlight", "underline"] or annot.type[0] in [8, 9]:
                    rect = annot.rect
                    
                    intersecting_words = []
                    for w in page_words:
                        word_rect = fitz.Rect(w[:4])
                        if word_rect.intersects(rect):
                            overlap = word_rect & rect
                            overlap_area = overlap.width * overlap.height if not overlap.is_empty else 0
                            word_area = word_rect.width * word_rect.height
                            
                            overlap_ratio = overlap_area / word_area if word_area > 0 else 0
                            if overlap_ratio >= 0.4:
                                intersecting_words.append(w)
                                
                    if not intersecting_words:
                        continue
                        
                    # Ignoramos subrayados de más de 3 palabras (citas o frases completas)
                    if len(intersecting_words) > 3:
                        continue
                        
                    intersecting_words.sort(key=lambda x: (x[6], x[0]))
                    highlighted_text = " ".join([w[4] for w in intersecting_words])
                    
                    clean_word = highlighted_text.strip(".,/#!$%^&*;:{}=-_`~()[]¿?¡!«»\"'")
                    if not clean_word:
                        continue
                        
                    word_key = clean_word.lower()
                    if word_key in seen_words:
                        continue
                    seen_words.add(word_key)
                    
                    # Buscamos el contexto de la oración completa
                    first_word_block = intersecting_words[0][5]
                    context = ""
                    for b in blocks:
                        if b[5] == first_word_block:
                            context = b[4].replace('\n', ' ').strip()
                            break
                            
                    if not context:
                        context = highlighted_text
                        
                    highlights.append({
                        "word": clean_word,
                        "context": context,
                        "page": page_num + 1
                    })
        
        doc.close()
        full_text = "\n\n".join(full_text_pages)
        print(f"🎉 Éxito: Extraído texto completo del libro y {len(highlights)} palabras subrayadas con alta precisión.")
        return jsonify({
            "filename": file.filename,
            "highlights": highlights,
            "full_text": full_text
        })
        
    except Exception as e:
        print(f"❌ Error procesando PDF: {e}")
        return jsonify({"error": f"Error al procesar el PDF: {str(e)}"}), 500

@app.route('/api/analyze', methods=['POST'])
def analyze_word():
    data = request.json
    word = data.get('word')
    context_sentence = data.get('context')
    
    prompt = f"""
    Actúa como un profesor de alemán experto. El usuario no entiende "{word}".
    Contexto: "...{context_sentence}..."
    Analiza "{word}" EN ESE CONTEXTO y devuelve JSON con:
    1. "es": Traducción español.
    2. "en": Traducción inglés.
    3. "grammar": Explicación gramatical breve.
    4. "examples": Array con 2 objetos {{"original": "...", "es_translation": "..."}}.
    """

    openai_client = get_openai_client()
    # 1. Intentar usar OpenAI como cliente principal (más rápido y de menor consumo con gpt-4o-mini)
    if openai_client:
        print(f"🤖 OpenAI analizando palabra: {word}...")
        try:
            response = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": "You are a language tutor. Output JSON."},
                    {"role": "user", "content": prompt}
                ]
            )
            import json
            content = response.choices[0].message.content
            return jsonify(json.loads(content))
        except Exception as openai_err:
            print(f"❌ Error en OpenAI, intentando fallback a Gemini: {openai_err}")
            # Si falla, continuará abajo e intentará Gemini

    gemini_client = get_gemini_client()
    # 2. Fallback a Gemini si está configurado
    if gemini_client:
        print(f"🤖 Gemini (fallback) analizando palabra: {word}...")
        try:
            from google.genai import types
            response = gemini_client.models.generate_content(
                model='gemini-2.5-flash',
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json"
                )
            )
            import json
            return jsonify(json.loads(response.text))
        except Exception as gemini_err:
            print(f"❌ Error en Gemini: {gemini_err}")
            return jsonify({"error": f"Error en Gemini: {str(gemini_err)}"}), 500

    return jsonify({"error": "No se encontró ningún cliente de IA activo (Gemini u OpenAI). Configura tus claves en 'frontend/.env'"}), 500

# --- ESCÁNER AUTOMÁTICO DE LIBROS PARA OBSIDIAN/SYNCTHING ---

def scan_local_books():
    import fitz
    books_dir = BOOKS_DIR
    if not books_dir.exists():
        os.makedirs(books_dir, exist_ok=True)
        print(f"📁 Creada carpeta de libros locales en: {books_dir}")
        return
        
    print(f"🔍 Escaneando libros PDF en busca de nuevos subrayados en: {books_dir}...")
    import glob
    
    pdf_files = glob.glob(str(books_dir / "*.pdf"))
    if not pdf_files:
        print("🔍 No se encontraron archivos PDF en la carpeta 'books/'.")
        return
        
    docs = get_all_documents()
    processed_titles = {d["title"] for d in docs}
    
    imported_count = 0
    
    for pdf_path in pdf_files:
        filename = os.path.basename(pdf_path)
        doc_title = f"Subrayados: {filename}"
        
        # Verificar si ya existe en la base de datos de Supabase
        if doc_title not in processed_titles:
            print(f"📖 Encontrado nuevo libro para importar automáticamente: {filename}...")
            try:
                doc = fitz.open(pdf_path)
                
                highlights = []
                seen_words = set()
                full_text_pages = []
                
                for page_num in range(len(doc)):
                    page = doc[page_num]
                    
                    # 1. Extraer texto estructurado por páginas y párrafos
                    blocks = page.get_text("blocks")
                    blocks.sort(key=lambda b: (b[1], b[0]))
                    
                    page_paragraphs = []
                    for b in blocks:
                        if b[6] == 0:
                            paragraph_text = b[4].replace('\n', ' ').strip()
                            if paragraph_text:
                                page_paragraphs.append(paragraph_text)
                                
                    if page_paragraphs:
                        page_content = f"<!-- PAGE {page_num + 1} -->\n" + "\n\n".join(page_paragraphs)
                        full_text_pages.append(page_content)
                        
                    # 2. Extraer subrayados de alta precisión
                    annots = page.annots()
                    if not annots:
                        continue
                        
                    page_words = page.get_text("words")
                    for annot in annots:
                        annot_type = annot.type[1].lower() if len(annot.type) > 1 else ""
                        if annot_type in ["highlight", "underline"] or annot.type[0] in [8, 9]:
                            rect = annot.rect
                            
                            intersecting_words = []
                            for w in page_words:
                                word_rect = fitz.Rect(w[:4])
                                if word_rect.intersects(rect):
                                    overlap = word_rect & rect
                                    overlap_area = overlap.width * overlap.height if not overlap.is_empty else 0
                                    word_area = word_rect.width * word_rect.height
                                    overlap_ratio = overlap_area / word_area if word_area > 0 else 0
                                    if overlap_ratio >= 0.4:
                                        intersecting_words.append(w)
                                        
                            if not intersecting_words:
                                continue
                                
                            if len(intersecting_words) > 3:
                                continue
                                
                            intersecting_words.sort(key=lambda x: (x[6], x[0]))
                            highlighted_text = " ".join([w[4] for w in intersecting_words])
                            clean_word = highlighted_text.strip(".,/#!$%^&*;:{}=-_`~()[]¿?¡!«»\"'")
                            if not clean_word:
                                continue
                                
                            word_key = clean_word.lower()
                            if word_key in seen_words:
                                continue
                            seen_words.add(word_key)
                            
                            first_word_block = intersecting_words[0][5]
                            context = ""
                            for b in blocks:
                                if b[5] == first_word_block:
                                    context = b[4].replace('\n', ' ').strip()
                                    break
                            if not context:
                                context = highlighted_text
                                
                            highlights.append({
                                "word": clean_word,
                                "context": context,
                                "page": page_num + 1
                            })
                
                doc.close()
                
                # Formato final con metadatos
                words_list = ", ".join([h["word"] for h in highlights])
                final_content = "\n\n".join(full_text_pages) + "\n---\n" + words_list
                
                # Guardar en Supabase
                doc_id = str(uuid.uuid4())
                insert_document(doc_id, doc_title, final_content, "en") # Por defecto inglés
                
                imported_count += 1
                print(f"✅ Libro importado con éxito: {filename} ({len(highlights)} subrayados)")
                
            except Exception as import_err:
                print(f"❌ Error al importar automáticamente {filename}: {import_err}")
                
    if imported_count > 0:
        print(f"🎉 Escaneo completado: Importados {imported_count} libros nuevos a tu Biblioteca local.")
    else:
        print("🔍 Escaneo completado: No se encontraron libros nuevos.")


# Esto permite correrlo con `python api/index.py` directamente
if __name__ == '__main__':
    # Ejecutar escáner automático de libros locales
    scan_local_books()
    app.run(debug=True, port=5000)