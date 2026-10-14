"""Sequential, resumable UVB import. Usage: python3 import_questions.py batch.json"""
import hashlib
import json
import re
import sys
import time
import unicodedata
import urllib.request

API = 'https://localflow.ddns.net/uvb/v1/apps/curiosity-heaven/items'

def key(question):
    return re.sub(r'[\W_]+', '', unicodedata.normalize('NFKC', question).casefold())

def request(url, payload=None):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode()
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as response:
        result = json.load(response)
    if result.get('ok') is not True:
        raise RuntimeError(result)
    return result['data']

def all_items():
    result = []
    page = 1
    while True:
        data = request(f'{API}?page={page}&page_size=200&order=asc')
        if data['page'] != page or (data['has_more'] and not data['items']):
            raise RuntimeError('Invalid pagination')
        result.extend(data['items'])
        if not data['has_more']:
            return result
        page += 1

def main():
    entries = json.load(open(sys.argv[1], encoding='utf-8'))
    assert isinstance(entries, list) and entries
    desired = {}
    for entry in entries:
        assert all(isinstance(entry.get(f), str) and entry[f].strip() for f in ('question', 'category', 'date_key', 'batch_id'))
        assert re.fullmatch(r'\d{4}-\d{2}-\d{2}', entry['date_key'])
        normalized = key(entry['question'])
        assert normalized and normalized not in desired, 'Duplicate input question'
        desired[normalized] = entry
    existing = {key(x['data'].get('question', '')) for x in all_items()}
    for normalized, entry in desired.items():
        if normalized in existing:
            continue
        entry = {**entry, 'schema_version': 1, 'question_key': hashlib.sha256(normalized.encode()).hexdigest()}
        # Do not blindly retry POST: a lost response may already have saved it.
        for attempt in range(3):
            try:
                saved = request(API, entry)
                assert key(saved['data']['question']) == normalized
                existing.add(normalized)
                break
            except Exception:
                time.sleep(attempt + 1)
                existing = {key(x['data'].get('question', '')) for x in all_items()}
                if normalized in existing:
                    break
                if attempt == 2:
                    raise
        print(f'confirmed {len(existing)}: {entry["question"]}', flush=True)
    rows = all_items()
    actual = {key(x['data'].get('question', '')) for x in rows}
    assert desired.keys() <= actual, 'Missing imported questions'
    print(json.dumps({'verified_input': len(desired), 'server_rows': len(rows), 'unique_questions': len(actual)}, ensure_ascii=False))

if __name__ == '__main__':
    main()
