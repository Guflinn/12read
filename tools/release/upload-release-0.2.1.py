#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
发 0.2.1：建 GitHub Release（Pre-release）+ 上传安装包与校验和。

与 upload-release-0.2.0.py 同一套路（本机无 gh CLI，走 REST API）。
差异：代理端口会变且今天直连可用 —— 候选表改为「直连优先」，再逐个探代理。

用法：python tools/release/upload-release-0.2.1.py
跑完会打印 Release 页面地址与附件清单；重复跑不会建第二个 Release（已存在就复用）。
"""

import json
import os
import pathlib
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

OWNER_REPO = 'Guflinn/12read'
TAG = 'v0.2.1'
TITLE = '十二阅读 v0.2.1 内测版（Windows）'
# 网络策略：先试直连（2026-10-10 实测 api.github.com 直连 200，且走代理上传
# 大附件曾断流），不通再按候选表探代理。
PROXY_CANDIDATES = [
    '',
    os.environ.get('TWELVE_READ_PROXY') or '',
    'http://127.0.0.1:7890',
    'http://127.0.0.1:4592',
]
PROXY = ''  # 由 pick_proxy() 填；'' = 直连
ROOT = pathlib.Path(__file__).resolve().parent.parent
NOTES = ROOT / 'tools' / 'release' / 'release-notes-0.2.1.md'
ASSETS = [
    ROOT / 'release' / 'twelve-read-setup-0.2.1.exe',
    ROOT / 'release' / 'twelve-read-setup-0.2.1.exe.sha256',
]

GIT_CANDIDATES = [
    r'C://Program Files\Git\cmd\git.exe',
    os.path.expanduser('~/.local/bin/git'),
    'git',
]


def token() -> str:
    for git in GIT_CANDIDATES:
        try:
            proc = subprocess.run(
                [git, 'credential', 'fill'],
                input='protocol=https\nhost=github.com\n\n',
                capture_output=True,
                text=True,
                timeout=60,
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        for line in proc.stdout.splitlines():
            if line.startswith('password='):
                return line.split('=', 1)[1]
    sys.exit('取不到 GitHub token（试过 ' + ', '.join(GIT_CANDIDATES) + '）')


def pick_proxy(tok: str) -> str:
    """探一次 api.github.com/zen，返回第一个能通的网络路径（'' = 直连优先）。"""
    for candidate in PROXY_CANDIDATES:
        handler = (
            urllib.request.ProxyHandler({})
            if candidate == ''
            else urllib.request.ProxyHandler({'http': candidate, 'https': candidate})
        )
        opener = urllib.request.build_opener(handler)
        req = urllib.request.Request(
            'https://api.github.com/zen',
            headers={'Authorization': 'token ' + tok, 'User-Agent': '12read-release-script'},
        )
        try:
            with opener.open(req, timeout=15):
                print('网络路径：' + ('直连' if candidate == '' else candidate))
                return candidate
        except Exception:
            continue
    sys.exit(
        '没有可用的网络路径（直连与候选代理都不通）——'
        '代理端口不同的话设 TWELVE_READ_PROXY=http://127.0.0.1:<端口>'
    )


def call(
    method: str,
    url: str,
    tok: str,
    payload=None,
    raw: bytes = None,
    ctype='application/json',
    allow=(200, 201),
):
    """allow 里的状态码不算失败（查询不存在的 Release 会拿 404，那是正常分支）。"""
    data = raw if raw is not None else (json.dumps(payload).encode('utf-8') if payload else None)
    req = urllib.request.Request(url, method=method, data=data)
    req.add_header('Authorization', 'token ' + tok)
    req.add_header('Accept', 'application/vnd.github+json')
    req.add_header('User-Agent', '12read-release-script')
    if data is not None:
        req.add_header('Content-Type', ctype)
    handler = (
        urllib.request.ProxyHandler({})
        if PROXY == ''
        else urllib.request.ProxyHandler({'http': PROXY, 'https': PROXY})
    )
    opener = urllib.request.build_opener(handler)
    try:
        with opener.open(req, timeout=600) as resp:
            body = resp.read().decode('utf-8')
            return resp.status, (json.loads(body) if body.strip().startswith(('{', '[')) else body)
    except urllib.error.HTTPError as err:
        body = err.read().decode('utf-8', 'replace')
        if err.code in allow:
            return err.code, None
        sys.exit('HTTP %s %s\n%s' % (err.code, url, body))


def main() -> None:
    if not NOTES.exists():
        sys.exit('缺少发版说明：' + str(NOTES))
    for asset in ASSETS:
        if not asset.exists():
            sys.exit('缺少产物：' + str(asset))

    tok = token()
    global PROXY
    PROXY = pick_proxy(tok)
    notes = NOTES.read_text(encoding='utf-8')

    status, existing = call(
        'GET',
        'https://api.github.com/repos/%s/releases/tags/%s' % (OWNER_REPO, TAG),
        tok,
        allow=(200, 404),
    )
    if status == 200:
        release = existing
        print('Release 已存在，复用：' + release['html_url'])
        call('PATCH', 'https://api.github.com/repos/%s/releases/%d' % (OWNER_REPO, release['id']), tok,
             {'body': notes, 'name': TITLE, 'prerelease': True})
    else:
        _, release = call('POST', 'https://api.github.com/repos/%s/releases' % OWNER_REPO, tok, {
            'tag_name': TAG,
            'name': TITLE,
            'body': notes,
            'draft': False,
            'prerelease': True,
        })
        print('Release 已创建：' + release['html_url'])

    uploaded = {asset['name'] for asset in release.get('assets', [])}
    for path in ASSETS:
        if path.name in uploaded:
            print('附件已存在，跳过：' + path.name)
            continue
        _, asset = call(
            'POST',
            'https://uploads.github.com/repos/%s/releases/%d/assets?name=%s'
            % (OWNER_REPO, release['id'], urllib.parse.quote(path.name)),
            tok,
            raw=path.read_bytes(),
            ctype='application/octet-stream',
        )
        print('已上传 %s（%d B）' % (path.name, asset['size']))

    print('\n完成。Release：' + release['html_url'])


if __name__ == '__main__':
    main()
