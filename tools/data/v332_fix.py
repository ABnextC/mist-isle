# v3.3.2 퀘스트·NPC 재점검: 데이터 판만 올린다(저장 모양 그대로).
import json, os
D = os.path.join(os.path.dirname(__file__), '..', '..', 'data')
p = os.path.join(D, 'config.json')
c = json.load(open(p))
c['dataVersion'] = max(c.get('dataVersion', 0), 38)
json.dump(c, open(p, 'w'), ensure_ascii=False, indent=2)
open(p, 'a').write('\n')
print('dataVersion', c['dataVersion'])
