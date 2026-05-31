import os
import json
import requests
from pathlib import Path
from dotenv import load_dotenv

# --- CONFIGURACIÓN DE SUPABASE ---
env_path = Path(__file__).resolve().parent.parent / 'frontend' / '.env'
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("VITE_SUPABASE_ANON_KEY")

# Eliminar barra inclinada final si existe en la URL
if SUPABASE_URL and SUPABASE_URL.endswith('/'):
    SUPABASE_URL = SUPABASE_URL[:-1]

def get_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }

def init_db():
    print("☁️ Supabase Cloud Database activa y configurada.")
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("⚠️ Advertencia: Faltan credenciales de Supabase en 'frontend/.env'")

# --- MÉTODOS DE DOCUMENTOS ---

def get_all_documents():
    if not SUPABASE_URL or not SUPABASE_KEY:
        return []
    
    url = f"{SUPABASE_URL}/rest/v1/documents?order=created_at.desc"
    try:
        r = requests.get(url, headers=get_headers())
        if r.status_code == 200:
            return r.json()
        else:
            print(f"❌ Error al consultar documentos en Supabase: {r.status_code} - {r.text}")
    except Exception as e:
        print(f"❌ Excepción al consultar documentos: {e}")
    return []

def insert_document(doc_id, title, content, language='auto', audio_url=None):
    payload = {
        "id": doc_id,
        "title": title,
        "content": content,
        "language": language,
        "audio_url": audio_url,
        "current_page": 1,
        "scroll_position": 0.0
    }
    
    if not SUPABASE_URL or not SUPABASE_KEY:
        return payload
        
    url = f"{SUPABASE_URL}/rest/v1/documents"
    try:
        r = requests.post(url, json=payload, headers=get_headers())
        if r.status_code in [200, 201]:
            rows = r.json()
            if rows:
                return rows[0]
    except Exception as e:
        print(f"❌ Excepción al insertar documento en Supabase: {e}")
    return payload

def update_document(doc_id, content):
    payload = {"content": content}
    
    if not SUPABASE_URL or not SUPABASE_KEY:
        return {"id": doc_id, "content": content}
        
    url = f"{SUPABASE_URL}/rest/v1/documents?id=eq.{doc_id}"
    try:
        r = requests.patch(url, json=payload, headers=get_headers())
        if r.status_code in [200, 204]:
            return {"id": doc_id, "content": content}
        else:
            print(f"❌ Error al actualizar documento en Supabase: {r.status_code} - {r.text}")
    except Exception as e:
        print(f"❌ Excepción al actualizar documento: {e}")
    return {"id": doc_id, "content": content}

def update_document_progress(doc_id, current_page, scroll_position):
    payload = {
        "current_page": int(current_page),
        "scroll_position": float(scroll_position)
    }
    
    if not SUPABASE_URL or not SUPABASE_KEY:
        return {"id": doc_id, "current_page": current_page, "scroll_position": scroll_position}
        
    url = f"{SUPABASE_URL}/rest/v1/documents?id=eq.{doc_id}"
    try:
        r = requests.patch(url, json=payload, headers=get_headers())
        if r.status_code in [200, 204]:
            return {"id": doc_id, "current_page": current_page, "scroll_position": scroll_position}
        else:
            print(f"❌ Error al actualizar progreso de documento en Supabase: {r.status_code} - {r.text}")
    except Exception as e:
        print(f"❌ Excepción al actualizar progreso: {e}")
    return {"id": doc_id, "current_page": current_page, "scroll_position": scroll_position}

# --- MÉTODOS DE VOCABULARIO ---

def get_cached_word(word, language):
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None
    
    url = f"{SUPABASE_URL}/rest/v1/word_cache?word=ilike.{word}&language=ilike.{language}"
    try:
        r = requests.get(url, headers=get_headers())
        if r.status_code == 200:
            rows = r.json()
            if rows:
                data = rows[0]
                # Si los datos vienen como string, los cargamos defensivamente
                if isinstance(data.get('translation_data'), str):
                    try:
                        data['translation_data'] = json.loads(data['translation_data'])
                    except Exception:
                        pass
                return data
    except Exception as e:
        print(f"❌ Excepción al consultar palabra en Supabase: {e}")
    return None

def insert_cached_word(word, language, translation_data):
    # Aseguramos que translation_data sea una estructura de diccionario/lista nativa
    if isinstance(translation_data, str):
        try:
            translation_data = json.loads(translation_data)
        except Exception:
            pass
            
    payload = {
        "word": word.lower(),
        "language": language.lower(),
        "translation_data": translation_data
    }
    
    if not SUPABASE_URL or not SUPABASE_KEY:
        return payload
        
    url = f"{SUPABASE_URL}/rest/v1/word_cache"
    headers = get_headers()
    # PostgREST Upsert: resolution=merge-duplicates
    headers["Prefer"] = "resolution=merge-duplicates,return=representation"
    try:
        r = requests.post(url, json=payload, headers=headers)
        if r.status_code in [200, 201]:
            rows = r.json()
            if rows:
                return rows[0]
        else:
            print(f"❌ Error al insertar palabra en Supabase: {r.status_code} - {r.text}")
    except Exception as e:
        print(f"❌ Excepción al insertar palabra en Supabase: {e}")
    return payload

def delete_cached_word(word, language):
    if not SUPABASE_URL or not SUPABASE_KEY:
        return {"word": word.lower(), "language": language.lower(), "deleted": False}
        
    url = f"{SUPABASE_URL}/rest/v1/word_cache?word=ilike.{word}&language=ilike.{language}"
    try:
        r = requests.delete(url, headers=get_headers())
        if r.status_code in [200, 204]:
            return {"word": word.lower(), "language": language.lower(), "deleted": True}
        else:
            print(f"❌ Error al eliminar palabra en Supabase: {r.status_code} - {r.text}")
    except Exception as e:
        print(f"❌ Excepción al eliminar palabra en Supabase: {e}")
    return {"word": word.lower(), "language": language.lower(), "deleted": False}
