import urllib.request
import json
import re
import os
import sys
import string
import subprocess

# 1. Instalar y descargar recursos de NLTK
print("Configurando NLTK y WordNet...")
try:
    import nltk
except ImportError:
    print("NLTK no encontrado. Instalando...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "nltk"])
    import nltk

# Descargar WordNet para lematización
nltk.download('wordnet', quiet=True)
nltk.download('omw-1.4', quiet=True)

from nltk.stem import WordNetLemmatizer
lemmatizer = WordNetLemmatizer()

# 2. Descargar diccionario raw
URL = "https://raw.githubusercontent.com/IvanDubls/llm_dictionary/main/llm_dict_enes/dictionaries/en_es_aidict.json"
print(f"Descargando base de datos del diccionario desde: {URL}...")

req = urllib.request.Request(URL, headers={'User-Agent': 'Mozilla/5.0'})
try:
    with urllib.request.urlopen(req) as response:
        raw_data = response.read().decode('utf-8')
except Exception as e:
    print(f"Error al descargar diccionario: {e}")
    sys.exit(1)

print("Parseando JSON (descompresión de doble codificación)...")
try:
    # La base de datos original está doblemente codificada en formato JSON cadena
    data = json.loads(json.loads(raw_data))
except Exception as e:
    print(f"Error al parsear el JSON: {e}")
    sys.exit(1)

print(f"Registros originales cargados: {len(data)}")

# Expresión regular para separar categorías gramaticales como "city (noun)"
word_pattern = re.compile(r'^([^(]+)(?:\(([^)]+)\))?$')

words_dict = {}
vocabulary = set()

# Puntuación a limpiar
translator = str.maketrans('', '', string.punctuation)

def clean_token(token):
    return token.lower().translate(translator).strip()

def is_valid_spanish_word(word):
    if len(word) <= 1:
        return word.lower() in ['a', 'o', 'y', 'e', 'u']
    word = word.lower().strip()
    # Check invalid single consonant endings
    if re.search(r'[fhjkqvx]$', word):
        return False
    # Check invalid multiple consonant endings
    if re.search(r'[bcdfghjklmnpqrstvwxyz]{2,}$', word):
        if not word.endswith(('s', 'n')):
            return False
    return True

print("Procesando e invirtiendo entradas (Español -> Inglés a Inglés -> Español)...")
for item in data:
    if not item:
        continue
    span_word = (item.get('word') or '').strip()
    trans_str = (item.get('translation') or '').strip()
    if not span_word or not trans_str or not is_valid_spanish_word(span_word):
        continue
        
    # Extraer oraciones de ejemplo
    ex1_es = (item.get('example_1') or '').strip()
    ex1_en = (item.get('example_translation_1') or '').strip()
    ex2_es = (item.get('example_2') or '').strip()
    ex2_en = (item.get('example_translation_2') or '').strip()
    
    # Separar traducciones si vienen en formato "word1; word2"
    parts = trans_str.split(';')
    for part in parts:
        part = part.strip()
        if not part:
            continue
            
        match = word_pattern.match(part)
        if not match:
            continue
            
        eng_raw = match.group(1).strip()
        grammar = match.group(2).strip() if match.group(2) else ""
        
        # Normalizar el término en inglés
        eng_word = eng_raw.lower()
        if eng_word.startswith("to ") and grammar.lower() == "verb":
            eng_word = eng_word[3:].strip()
            
        if not eng_word or len(eng_word.split()) > 4:
            # Ignorar frases extremadamente largas para mantener el diccionario enfocado
            continue
            
        # Añadir al vocabulario general para lematización
        vocabulary.add(eng_word)
        for token in eng_word.split():
            vocabulary.add(clean_token(token))
            
        # Analizar ejemplos y agregar al vocabulario de ejemplos
        examples_to_add = []
        if ex1_en and ex1_es:
            examples_to_add.append({"original": ex1_en, "es_translation": ex1_es})
            for token in ex1_en.split():
                vocabulary.add(clean_token(token))
        if ex2_en and ex2_es:
            examples_to_add.append({"original": ex2_en, "es_translation": ex2_es})
            for token in ex2_en.split():
                vocabulary.add(clean_token(token))
                
        # Construir/actualizar entrada invertida en inglés
        if eng_word not in words_dict:
            words_dict[eng_word] = {
                "es": span_word,
                "grammar": grammar,
                "alternatives": [],
                "examples": examples_to_add[:2]
            }
        else:
            entry = words_dict[eng_word]
            # Si no hay categoría gramatical y esta parte sí tiene, la guardamos
            if not entry["grammar"] and grammar:
                entry["grammar"] = grammar
            # Si la traducción en español es distinta, la agregamos a alternativas
            if entry["es"] != span_word and span_word not in entry["alternatives"]:
                entry["alternatives"].append(span_word)
            # Combinar ejemplos únicos
            existing_exs = [ex["original"].lower() for ex in entry["examples"]]
            for ex in examples_to_add:
                if ex["original"].lower() not in existing_exs and len(entry["examples"]) < 2:
                    entry["examples"].append(ex)
                    existing_exs.append(ex["original"].lower())

print(f"Diccionario base construido con {len(words_dict)} palabras únicas en inglés.")

# 3. Generar el mapa de lematización (lemma map)
print("Generando mapa de lematización con WordNet Lemmatizer...")
lemmas_map = {}
for word in list(vocabulary):
    if not word or len(word) < 2 or word in words_dict:
        continue
        
    # Probar diferentes etiquetas POS para ver si logramos reducirlo a un lema conocido
    for pos in ['v', 'n', 'a']:
        lemma = lemmatizer.lemmatize(word, pos=pos)
        if lemma != word and lemma in words_dict:
            lemmas_map[word] = lemma
            break

print(f"Mapa de lematización generado con {len(lemmas_map)} mapeos (formas conjugadas -> base).")

# 3.5 Optimizar el tamaño de las entradas
print("Optimizando tamaño de las entradas para uso PWA offline...")
optimized_words = {}
for i, (eng_word, entry) in enumerate(words_dict.items()):
    new_entry = entry.copy()
    
    # Conservar máximo 1 ejemplo y sólo para las primeras 12,000 palabras (las más frecuentes)
    if i < 12000:
        new_entry["examples"] = entry.get("examples", [])[:1]
    else:
        new_entry["examples"] = []
        
    # Eliminar claves vacías para ahorrar bytes en el JSON final
    if not new_entry.get("alternatives"):
        new_entry.pop("alternatives", None)
    if not new_entry.get("examples"):
        new_entry.pop("examples", None)
    if not new_entry.get("grammar"):
        new_entry.pop("grammar", None)
        
    optimized_words[eng_word] = new_entry

# 4. Guardar archivo final
output_data = {
    "words": optimized_words,
    "lemmas": lemmas_map
}

dest_dir = "/Users/book/Documents/lang-transcriber/frontend/public"
os.makedirs(dest_dir, exist_ok=True)
dest_path = os.path.join(dest_dir, "dictionary_en_es.json")

print(f"Guardando diccionario compilado en {dest_path}...")
with open(dest_path, 'w', encoding='utf-8') as f:
    # Escribir de forma compacta (sin sangrías) para ahorrar tamaño de archivo
    json.dump(output_data, f, ensure_ascii=False, separators=(',', ':'))

file_size_mb = os.path.getsize(dest_path) / (1024 * 1024)
print(f"¡Diccionario guardado con éxito! Tamaño del archivo: {file_size_mb:.2f} MB")
