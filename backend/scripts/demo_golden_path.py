"""Golden path against the running API. Prints what a demo would show."""
import json, sys, time, uuid
import urllib.request as R

API = "http://localhost:8000"
TOKEN = None

def call(method, path, body=None, headers=None, raw_url=None, data=None, ctype="application/json"):
    url = raw_url or API + path
    payload = data if data is not None else (json.dumps(body).encode() if body is not None else None)
    req = R.Request(url, data=payload, method=method)
    if payload is not None:
        req.add_header("Content-Type", ctype)
    if TOKEN and not raw_url:
        req.add_header("Authorization", f"Bearer {TOKEN}")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with R.urlopen(req) as resp:
            text = resp.read().decode()
            return resp.status, (json.loads(text) if text and resp.status != 204 else None)
    except R.HTTPError as e:
        text = e.read().decode()
        try: return e.code, json.loads(text)
        except ValueError: return e.code, {"raw": text[:300]}

def head(n): print(f"\n\033[1m{n}\033[0m")

head("1. login")
_, tok = call("POST", "/v1/auth/login", {"email": "rep@shelfeye.demo", "password": "demo1234"})
TOKEN = tok["accessToken"]
print(f"  token {TOKEN[:26]}... expires in {tok['expiresIn']}s")

head("2. today's route  (risk DESC, distance ASC)")
_, stops = call("GET", "/v1/routes/today?lat=13.7051&lng=100.6012")
for s in stops:
    print(f"  {s['riskBand']:<6} score={s['riskScore']:.3f}  {s['distanceKm']:>5.1f}km  {s['name']}")
store = stops[0]

head("3. check-in  (GPS ~5km off: flagged, NOT blocked)")
_, visit = call("POST", "/v1/visits", {
    "storeId": store["id"], "gpsLat": 13.75, "gpsLng": 100.65, "photoConsentConfirmed": True})
print(f"  visit {visit['id'][:8]}  gpsMatch={visit['gpsMatch']}  status={visit['status']}")

head("4. presign  (image bytes never touch the API process)")
_, pre = call("POST", "/v1/captures/presign", {
    "visitId": visit["id"], "category": "coffee",
    "shelfBayLabel": "BAY-01", "phase": "BEFORE"})
print(f"  objectKey {pre['objectKey']}")
print(f"  uploadUrl {pre['uploadUrl'][:78]}...")

head("5. PUT straight to object storage")
status, _ = call("PUT", "", raw_url=pre["uploadUrl"], data=b"fake-jpeg-bytes", ctype="image/jpeg")
print(f"  HTTP {status}")

head("6. commit -> 202 Accepted")
idem = f"demo-{uuid.uuid4()}"
status, job = call("POST", f"/v1/captures/{pre['captureId']}/commit",
                   {"imageWidth": 1920, "imageHeight": 1080,
                    "faceBlurApplied": True, "faceBlurCount": 0},
                   headers={"Idempotency-Key": idem})
print(f"  HTTP {status}  job {job['jobId'][:8]}  status={job['status']}")

head("6b. replay the same Idempotency-Key")
_, job2 = call("POST", f"/v1/captures/{pre['captureId']}/commit",
               {"imageWidth": 1920, "imageHeight": 1080},
               headers={"Idempotency-Key": idem})
assert job2["jobId"] == job["jobId"], "DUPLICATE JOB CREATED"
print(f"  same job id returned -> idempotent")

head("7. poll (client polls every 500ms while the rep waits)")
for i in range(30):
    _, j = call("GET", f"/v1/jobs/{job['jobId']}")
    print(f"  poll {i+1}: {j['status']:<8} {j['progressHint']}")
    if j["status"] in ("DONE", "FAILED"): break
    time.sleep(0.5)
if j["status"] == "FAILED":
    print(f"  errorCode={j['errorCode']} userMessage={j['userMessage']}")
    sys.exit(1)

head("8. result")
_, r = call("GET", f"/v1/captures/{pre['captureId']}/result")
print(f"  osaScore={r['osaScore']:.4f}  status={r['status']}  rows={r['rowCount']}  gapRatio={r['gapRatio']:.4f}")
print(f"  model={r['modelVersion']}  detections={len(r['detections'])}  findings={len(r['gapFindings'])}  lowConf={r['lowConfidenceCount']}")
for f in r["gapFindings"]:
    flag = " [ต้องตรวจสอบ]" if f["isLowConfidence"] else ""
    print(f"    · {f['positionLabel']}  {f['skuName']} ({f['skuCode']})  conf={f['confidence']}{flag}")

json.dump({"visit": visit["id"], "capture": pre["captureId"],
           "findings": [f["id"] for f in r["gapFindings"]], "token": TOKEN},
          open(sys.argv[1] if len(sys.argv) > 1 else "/tmp/golden_state.json", "w"))
