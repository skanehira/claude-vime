-- nvim --headless -l bridge.lua
-- stdin:  {"yomi":"きょうはいい","resizes":[[0,1]],"commit":[0,0]}  (0-based as anthy counts; resizes and commit optional)
-- stdout: {"segments":[{"yomi":"きょう","candidates":["今日",...]}]}  or  {"error":"..."}
local ffi = require("ffi")

local ANTHY_UTF8_ENCODING = 2
local NTH_UNCONVERTED_CANDIDATE = -1

ffi.cdef([[
  typedef void *anthy_context_t;
  int anthy_init(void);
  anthy_context_t anthy_create_context(void);
  void anthy_release_context(anthy_context_t);
  int anthy_context_set_encoding(anthy_context_t, int);
  int anthy_set_string(anthy_context_t, const char *);
  struct anthy_conv_stat { int nr_segment; };
  struct anthy_segment_stat { int nr_candidate; int seg_len; };
  void anthy_get_stat(anthy_context_t, struct anthy_conv_stat *);
  void anthy_get_segment_stat(anthy_context_t, int, struct anthy_segment_stat *);
  int anthy_get_segment(anthy_context_t, int, int, char *, int);
  int anthy_resize_segment(anthy_context_t, int, int);
  int anthy_commit_segment(anthy_context_t, int, int);
]])

local function lib_ext()
  return vim.uv.os_uname().sysname == "Darwin" and "dylib" or "so"
end

local function lib_candidates()
  local ext = lib_ext()
  local names = { "libanthy-unicode." .. ext, "libanthy." .. ext }
  local dirs = {
    vim.fn.expand("~/.local/lib"),
    vim.fn.expand("~/.nix-profile/lib"),
    "/run/current-system/sw/lib",
    "/opt/homebrew/lib",
    "/usr/local/lib",
    "/usr/lib",
    "/usr/lib64",
    "/usr/lib/x86_64-linux-gnu",
    "/usr/lib/aarch64-linux-gnu",
  }
  local list = {}
  for _, dir in ipairs(dirs) do
    for _, name in ipairs(names) do
      list[#list + 1] = dir .. "/" .. name
    end
  end
  for _, name in ipairs(names) do
    for _, hit in ipairs(vim.fn.glob("/nix/store/*-anthy*/lib/" .. name, false, true)) do
      list[#list + 1] = hit
    end
  end
  return list
end

local function find_lib()
  local env = vim.env.VIME_ANTHY_LIB
  if env and env ~= "" and vim.fn.filereadable(env) == 1 then
    return env
  end
  for _, path in ipairs(lib_candidates()) do
    if vim.fn.filereadable(path) == 1 then
      return path
    end
  end
  return nil
end

local function get_segment(l, ctx, seg, nth)
  local need = l.anthy_get_segment(ctx, seg, nth, nil, 0)
  local buf = ffi.new("char[?]", need + 1)
  l.anthy_get_segment(ctx, seg, nth, buf, need + 1)
  return ffi.string(buf)
end

local function read_segments(l, ctx)
  local st = ffi.new("struct anthy_conv_stat")
  l.anthy_get_stat(ctx, st)
  local segs = {}
  for i = 0, st.nr_segment - 1 do
    local ss = ffi.new("struct anthy_segment_stat")
    l.anthy_get_segment_stat(ctx, i, ss)
    local cands = {}
    for j = 0, ss.nr_candidate - 1 do
      cands[#cands + 1] = get_segment(l, ctx, i, j)
    end
    segs[#segs + 1] = { yomi = get_segment(l, ctx, i, NTH_UNCONVERTED_CANDIDATE), candidates = cands }
  end
  return segs
end

local function respond(tbl)
  io.stdout:write(vim.json.encode(tbl), "\n")
end

local function main()
  local line = io.stdin:read("*l")
  if not line or line == "" then
    return respond({ error = "empty request" })
  end
  local ok, req = pcall(vim.json.decode, line)
  if not ok or type(req) ~= "table" or type(req.yomi) ~= "string" or req.yomi == "" then
    return respond({ error = "invalid request" })
  end
  local path = find_lib()
  if not path then
    return respond({ error = "libanthy not found" })
  end
  local loaded, l = pcall(ffi.load, path)
  if not loaded then
    return respond({ error = "failed to load " .. path })
  end
  if l.anthy_init() ~= 0 then
    return respond({ error = "anthy_init failed" })
  end
  local ctx = l.anthy_create_context()
  l.anthy_context_set_encoding(ctx, ANTHY_UTF8_ENCODING)
  l.anthy_set_string(ctx, req.yomi)
  for _, r in ipairs(req.resizes or {}) do
    l.anthy_resize_segment(ctx, r[1], r[2])
  end
  local segs = read_segments(l, ctx)
  if type(req.commit) == "table" then
    for i, cand in ipairs(req.commit) do
      l.anthy_commit_segment(ctx, i - 1, cand)
    end
  end
  l.anthy_release_context(ctx)
  respond({ segments = segs })
end

main()
