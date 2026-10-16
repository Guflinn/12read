#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
发 0.4.0：建附注 tag（若缺）+ 建 GitHub Release（Pre-release）+ 上传安装包、更新元数据（latest.yml / blockmap）。

与 upload-release-0.3.0.py 同一套路（本机无 gh CLI，走 REST API；直连优先；
附注 tag 走 REST API 建 —— `git push tag` 在本机会连续 schannel SSL 中断）。

用法：python tools/release/upload-release-0.4.0.py
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
TAG = 'v0.4.0'
TITLE = '十二阅读 v0.4.0 内测版（Windows）'
TAG_MESSAGE = '内测版：新增 Markdown 与文字层 PDF（共五种格式）、备份还原、应用内更新，并修掉关窗与导入 PDF 的两个崩。'
# 网络策略：先试直连（api.github.com 直连可用，走代理上传大附件曾断流），
# 不通再按候选表探代理（端口会变，可用 TWELVE_READ_PROXY 指定）。
PROXY_CANDIDATES = [
    '',
    os.environ.get('TWELVE_READ_PROXY') or '',
    'http://127.0.0.1:7890',
    'http://127.0.0.1:4592',
]
PROXY = ''  # 由 pick_proxy() 填；'' = 直连
# tools/release/xxx.py → parents[2] 才是仓库根
ROOT = pathlib.Path(__file__).resolve().parents[2]
NOTES = ROOT / 'tools' / 'release' / 'release-notes-0.4.0.md'
# 0.4.0 起多两样：latest.yml 与 blockmap 是 electron-updater 的差量更新元数据，
# 少了客户端会报「找不到 latest.yml」—— 必须和 exe 一起传。
ASSETS = [
    ROOT / 'release' / 'twelve-read-setup-0.4.0.exe',
    ROOT / 'release' / 'twelve-read-portable-0.4.0.exe',
    ROOT / 'release' / 'latest.yml',
    ROOT / 'release' / 'twelve-read-setup-0.4.0.exe.blockmap',
]

GIT_CANDIDATES = [
    r'C://Program Files\Git\cmd\git.exe',
    os.path.expanduser('~/.local/bin/git'),
    'git',
]


def git(*args: str) -> str:
    """用官方 git 跑一条只读命令（PortableGit 会弹凭据选择器，别用它）。"""
    for candidate in GIT_CANDIDATES:
        try:
            proc = subprocess.run(
                [candidate, *args], capture_output=True, text=True, timeout=60
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        if proc.returncode == 0:
            return proc.stdout.strip()
    sys.exit('跑不了 git：' + ' '.join(args))


def token() -> str:
    """优先吃环境变量里的个人令牌（本机已设 GITHUB_TOKEN）；没有再退回凭据管理器。"""
    for key in ('GITHUB_TOKEN', 'GH_TOKEN'):
        value = os.environ.get(key)
        if value:
            print('令牌来源：环境变量 ' + key)
            return value
    for git_exe in GIT_CANDIDATES:
        try:
            proc = subprocess.run(
                [git_exe, 'credential', 'fill'],
                input='protocol=https\nhost=github.com\n\n',
                capture_output=True,
                text=True,
                timeout=60,
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        for line in proc.stdout.splitlines():
            if line.startswith('password='):
                print('令牌来源：git credential fill')
                return line.split('=', 1)[1]
    sys.exit('取不到 GitHub token（环境变量 GITHUB_TOKEN 未设，git credential fill 也没拿到）')


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
    """allow 里的状态码不算失败（查询不存在的 tag / Release 会拿 404，那是正常分支）。"""
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


def ensure_tag(tok: str, sha: str) -> None:
    """附注 tag 走 REST API 建（`git push tag` 在本机连续 SSL 中断）。"""
    status, _ = call(
        'GET', 'https://api.github.com/repos/%s/git/ref/tags/%s' % (OWNER_REPO, TAG), tok,
        allow=(200, 404),
    )
    if status == 200:
        print('tag %s 远端已存在，跳过' % TAG)
        return
    _, tag_object = call('POST', 'https://api.github.com/repos/%s/git/tags' % OWNER_REPO, tok, {
        'tag': TAG,
        'message': TAG_MESSAGE,
        'object': sha,          # 必须是 commit sha，不是 tag 对象自身
        'type': 'commit',
    })
    call('POST', 'https://api.github.com/repos/%s/git/refs' % OWNER_REPO, tok, {
        'ref': 'refs/tags/' + TAG,
        'sha': tag_object['sha'],
    })
    print('附注 tag 已建：%s → %s' % (TAG, sha[:7]))


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

    head = git('rev-parse', 'HEAD')
    local = git('rev-parse', 'main')
    if head != local:
        sys.exit('HEAD 与 main 不一致（HEAD=%s main=%s）' % (head[:7], local[:7]))
    print('将发布的 commit：' + head[:7])

    ensure_tag(tok, head)

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
