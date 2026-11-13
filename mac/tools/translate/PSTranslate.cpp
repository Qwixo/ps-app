// PSTranslate: PS's offline translator, a small helper process (Minecraft mode, Nov 2026).
// PS starts it with the model folder, talks to it over stdin and stdout, and kills it to cancel or when idle,
// so a slow translation never touches PS's main thread and a crash here never takes PS down.
// It never opens a socket or a file outside the model folder. Engine: Meta's NLLB-200 (distilled) run by
// CTranslate2 (int8 on the CPU with Ruy and Apple Accelerate), tokens by SentencePiece.
//
//   PSTranslate <model dir> [threads]
//   first line out:  ready\t<load ms>            or  fail\t<base64 message>
//   each line in:    <id>\tping                   ->  <id>\tok\t\t0
//                    <id>\ttr\t<src>\t<tgt>\t<base64 utf8 text>   (src, tgt: NLLB codes like kat_Geor)
//                                                ->  <id>\tok\t<base64 utf8 text>\t<ms>  or  <id>\terr\t<base64 message>\t0
// Lines keep their breaks: every non empty line is translated on its own, in one batch.
#include <ctranslate2/translator.h>
#include <sentencepiece_processor.h>

#include <chrono>
#include <iostream>
#include <sstream>
#include <string>
#include <thread>
#include <unistd.h>
#include <vector>

static const char* B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static std::string b64enc(const std::string& in) {
  std::string out;
  int val = 0, bits = -6;
  for (unsigned char c : in) {
    val = (val << 8) + c; bits += 8;
    while (bits >= 0) { out.push_back(B64[(val >> bits) & 0x3F]); bits -= 6; }
  }
  if (bits > -6) out.push_back(B64[((val << 8) >> (bits + 8)) & 0x3F]);
  while (out.size() % 4) out.push_back('=');
  return out;
}

static std::string b64dec(const std::string& in) {
  std::vector<int> t(256, -1);
  for (int i = 0; i < 64; i++) t[(unsigned char)B64[i]] = i;
  std::string out;
  int val = 0, bits = -8;
  for (unsigned char c : in) {
    if (t[c] == -1) break;
    val = (val << 6) + t[c]; bits += 6;
    if (bits >= 0) { out.push_back(char((val >> bits) & 0xFF)); bits -= 8; }
  }
  return out;
}

static std::vector<std::string> split(const std::string& s, char sep) {
  std::vector<std::string> parts;
  std::string cur;
  for (char c : s) { if (c == sep) { parts.push_back(cur); cur.clear(); } else cur.push_back(c); }
  parts.push_back(cur);
  return parts;
}

static bool hasLetter(const std::string& s) {
  for (unsigned char c : s) if (std::isalpha(c) || c >= 0x80) return true;
  return false;
}

static bool knownLang(const std::string& code) {
  return code == "eng_Latn" || code == "rus_Cyrl" || code == "kat_Geor";
}

// Georgian SMS put "straight quotes" round names, and NLLB then often makes up a whole sentence (a Magti SMS
// came out as a Watchtower advert). Georgian quotes („...“) read right, so straight pairs become those.
static std::string georgianQuotes(const std::string& s) {
  std::string out;
  bool open = true;
  for (char c : s) {
    if (c == '"') { out += open ? "\xE2\x80\x9E" : "\xE2\x80\x9C"; open = !open; }
    else out.push_back(c);
  }
  return open ? out : s;   // an odd number of quotes: leave the line as it was
}

static size_t words(const std::string& s) {
  size_t n = 0; bool in = false;
  for (char c : s) { bool sp = c == ' ' || c == '\t'; if (!sp && !in) n++; in = !sp; }
  return n;
}

// Long lines are cut at sentence ends so each piece stays well inside what the model reads well.
static std::vector<std::string> sentences(const std::string& line) {
  std::vector<std::string> out;
  if (line.size() < 400) { out.push_back(line); return out; }
  std::string cur;
  for (size_t i = 0; i < line.size(); i++) {
    cur.push_back(line[i]);
    bool end = (line[i] == '.' || line[i] == '!' || line[i] == '?') && i + 1 < line.size() && line[i + 1] == ' ';
    if (end && cur.size() > 40) { out.push_back(cur); cur.clear(); i++; }
  }
  if (!cur.empty()) out.push_back(cur);
  return out;
}

int main(int argc, char** argv) {
  std::ios::sync_with_stdio(false);
  if (argc < 2) { std::cout << "fail\t" << b64enc("usage: PSTranslate <model dir> [threads]") << "\n" << std::flush; return 2; }
  const std::string dir = argv[1];
  size_t threads = argc > 2 ? std::max(1, std::atoi(argv[2])) : 4;
  auto t0 = std::chrono::steady_clock::now();
  sentencepiece::SentencePieceProcessor sp;
  std::unique_ptr<ctranslate2::Translator> tr;
  try {
    auto st = sp.Load(dir + "/sentencepiece.bpe.model");
    if (!st.ok()) throw std::runtime_error("tokenizer: " + st.ToString());
    ctranslate2::ReplicaPoolConfig pool;
    pool.num_threads_per_replica = threads;
    tr = std::make_unique<ctranslate2::Translator>(dir, ctranslate2::Device::CPU, ctranslate2::ComputeType::INT8, std::vector<int>{0}, false, pool);
  } catch (const std::exception& e) {
    std::cout << "fail\t" << b64enc(e.what()) << "\n" << std::flush;
    return 1;
  }
  auto loadMs = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count();
  // Every token with an old Georgian letter (U+10F1 to U+10FA, UTF-8 E1 83 B1 to E1 83 BA).
  std::vector<std::vector<std::string>> archaic;
  for (int i = 0; i < sp.GetPieceSize(); i++) {
    const std::string& pc = sp.IdToPiece(i);
    for (size_t k = 0; k + 2 < pc.size(); k++)
      if ((unsigned char)pc[k] == 0xE1 && (unsigned char)pc[k + 1] == 0x83 && (unsigned char)pc[k + 2] >= 0xB1 && (unsigned char)pc[k + 2] <= 0xBA) { archaic.push_back({pc}); break; }
  }

  // One text from src to tgt, line by line (see the top of this file).
  auto translate = [&](const std::string& src, const std::string& tgt, const std::string& text) -> std::string {
    // Every line on its own; empty or letterless lines (numbers, codes) come back exactly as they were.
    std::vector<std::string> lines = split(text, '\n');
    std::vector<std::vector<std::string>> batch;
    std::vector<std::pair<size_t, size_t>> where;   // (line, how many pieces it was cut into)
    for (size_t i = 0; i < lines.size(); i++) {
      std::string l = lines[i];
      if (!l.empty() && l.back() == '\r') l.pop_back();
      if (!hasLetter(l)) { where.push_back({i, 0}); continue; }
      if (src == "kat_Geor") l = georgianQuotes(l);
      auto parts = sentences(l);
      for (auto& p : parts) {
        std::vector<std::string> toks;
        sp.Encode(p, &toks);
        if (toks.size() > 400) toks.resize(400);
        toks.insert(toks.begin(), src);
        toks.push_back("</s>");
        batch.push_back(toks);
      }
      where.push_back({i, parts.size()});
    }
    std::vector<std::string> outs;
    if (!batch.empty()) {
      ctranslate2::TranslationOptions o;
      o.beam_size = 4;
      o.max_decoding_length = 300;
      o.repetition_penalty = 1.05f;
      o.return_scores = true;
      // NLLB sometimes writes Georgian as Cyrillic words spelled in Georgian letters, using the old letters
      // (ჱ ჲ ჳ ...) modern Georgian never uses. Those pieces are forbidden when the answer is Georgian.
      if (tgt == "kat_Geor") o.suppress_sequences = archaic;
      auto run = [&](const std::vector<std::vector<std::string>>& b) {
        std::vector<std::vector<std::string>> prefix(b.size(), std::vector<std::string>{tgt});
        return tr->translate_batch(b, prefix, o, 8);
      };
      auto res = run(batch);
      for (size_t r = 0; r < res.size(); r++) {
        auto pick = [&](const ctranslate2::TranslationResult& x, float* score) {
          std::vector<std::string> h = x.output();
          if (!h.empty() && h.front() == tgt) h.erase(h.begin());
          std::string s; sp.Decode(h, &s);
          *score = x.scores.empty() ? 0.f : x.scores[0];
          return s;
        };
        float score = 0;
        std::string best = pick(res[r], &score);
        // A made up sentence: unsure (low score) AND much longer than what came in. Try the line once more
        // with its ! as a full stop (that alone stops most of them) and keep whichever the model is surer of.
        std::string orig; sp.Decode(std::vector<std::string>(batch[r].begin() + 1, batch[r].end() - 1), &orig);
        if (score < -1.0f && words(best) > words(orig) * 3 / 2 + 2) {
          std::string calm = orig;
          for (auto& c : calm) if (c == '!') c = '.';
          std::vector<std::string> toks; sp.Encode(calm, &toks);
          toks.insert(toks.begin(), src); toks.push_back("</s>");
          auto again = run({toks});
          float s2 = 0; std::string other = pick(again[0], &s2);
          if (s2 > score) { best = other; if (!best.empty() && best.back() == '.' && !orig.empty() && orig.back() == '!') best.back() = '!'; }
        }
        outs.push_back(best);
      }
    }
    std::ostringstream all;
    size_t k = 0;
    for (size_t j = 0; j < where.size(); j++) {
      if (j) all << "\n";
      auto [i, n] = where[j];
      if (n == 0) { std::string l = lines[i]; if (!l.empty() && l.back() == '\r') l.pop_back(); all << l; continue; }
      for (size_t m = 0; m < n; m++) { if (m) all << " "; all << outs[k++]; }
    }
    return all.str();
  };

  std::cout << "ready\t" << loadMs << "\n" << std::flush;

  std::string line;
  while (std::getline(std::cin, line)) {
    auto f = split(line, '\t');
    if (f.size() < 2) continue;
    const std::string& id = f[0];
    if (f[1] == "ping") { std::cout << id << "\tok\t\t0\n" << std::flush; continue; }
    if (f[1] != "tr" || f.size() < 5 || !knownLang(f[2]) || !knownLang(f[3])) {
      std::cout << id << "\terr\t" << b64enc("bad request") << "\t0\n" << std::flush;
      continue;
    }
    auto t1 = std::chrono::steady_clock::now();
    try {
      const std::string text = b64dec(f[4]);
      std::string out;
      // English to Georgian goes through Russian: straight it is unreliable in NLLB-200 1.3B (3 of 7 short test
      // sentences came out as gibberish), through Russian all 7 were right and natural (4 Nov 2026).
      if (f[2] == "eng_Latn" && f[3] == "kat_Geor") out = translate("rus_Cyrl", "kat_Geor", translate("eng_Latn", "rus_Cyrl", text));
      else out = translate(f[2], f[3], text);
      auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t1).count();
      std::cout << id << "\tok\t" << b64enc(out) << "\t" << ms << "\n" << std::flush;
    } catch (const std::exception& e) {
      std::cout << id << "\terr\t" << b64enc(e.what()) << "\t0\n" << std::flush;
    }
  }
  return 0;
}
