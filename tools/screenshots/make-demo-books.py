# -*- coding: utf-8 -*-
"""生成 README 截图用的演示书。

内容全部取自公版书（鲁迅，1936 年逝世，著作权已进入公有领域），
封面由本脚本用开源/系统字体现画 —— 不把任何版权书的内容或封面带进仓库。

用法：python make-demo-books.py <输出目录>
产出：
  《呐喊》鲁迅.txt
  《彷徨》鲁迅.txt
  《朝花夕拾》鲁迅.epub（带脚本生成的封面）
"""

import sys
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

PAPER = (246, 243, 237)
INK = (44, 42, 38)
ACCENT = (178, 58, 44)  # 朱红，与应用图标的书签同色系

SONG = "C:/Windows/Fonts/stzhongs.ttf"  # 华文中宋（Windows 中文版自带，仅本机渲染用，不进仓库）


def chapter(title: str, paragraphs: list[str]) -> str:
    return title + "\n\n" + "\n\n".join(paragraphs) + "\n"


NAIHAN = [
    chapter(
        "第一篇 自序",
        [
            "我在年青时候也曾经做过许多梦，后来大半忘却了，但自己也并不以为可惜。所谓回忆者，"
            "虽说可以使人欢欣，有时也不免使人寂寞，使精神的丝缕还牵着己逝的寂寞的时光，"
            "又有什么意味呢，而我偏苦于不能全忘却，这不能全忘的一部分，到今天便成了《呐喊》的来由。",
            "有谁从小康人家而坠入困顿的么，我以为在这途路中，大概可以看见世人的真面目；"
            "我要到N进K学堂去了，仿佛是想走异路，逃异地，去寻求别样的人们。",
        ],
    ),
    chapter(
        "第二篇 狂人日记",
        [
            "今天晚上，很好的月光。我不见他，已是三十多年；今天见了，精神分外爽快。"
            "才知道以前的三十多年，全是发昏；然而须十分小心。不然，那赵家的狗，何以看我两眼呢？我怕得有理。",
            "凡事总须研究，才会明白。古来时常吃人，我也还记得，可是不甚清楚。"
            "我翻开历史一查，这历史没有年代，歪歪斜斜的每叶上都写着「仁义道德」几个字。"
            "我横竖睡不着，仔细看了半夜，才从字缝里看出字来，满本都写着两个字是「吃人」！",
        ],
    ),
    chapter(
        "第三篇 孔乙己",
        [
            "鲁镇的酒店的格局，是和别处不同的：都是当街一个曲尺形的大柜台，柜里面预备着热水，"
            "可以随时温酒。做工的人，傍午傍晚散了工，每每花四文铜钱，买一碗酒，——这是二十多年前的事，"
            "现在每碗要涨到十文，——靠柜外站着，热热的喝了休息；倘肯多花一文，便可以买一碟盐煮笋，"
            "或者茴香豆，做下酒物了，如果出到十几文，那就能买一样荤菜，但这些顾客，多是短衣帮，大抵没有这样阔绰。",
            "孔乙己是站着喝酒而穿长衫的唯一的人。他身材很高大；青白脸色，皱纹间时常夹些伤痕；"
            "一部乱蓬蓬的花白的胡子。穿的虽然是长衫，可是又脏又破，似乎十多年没有补，也没有洗。",
        ],
    ),
    chapter(
        "第四篇 故乡",
        [
            "我冒了严寒，回到相隔二千余里，别了二十余年的故乡去。时候既然是深冬；渐近故乡时，"
            "天气又阴晦了，冷风吹进船舱中，呜呜的响，从篷隙向外一望，苍黄的天底下，"
            "远近横着几个萧索的荒村，没有一些活气。我的心禁不住悲凉起来了。",
            "啊！这不是我二十年来时时记得的故乡？我所记得的故乡全不如此。我的故乡好得多了。"
            "但要我记起它的美丽，说出它的佳处来，却又没有影像，没有言辞。仿佛也就如此。于是我自己解释说："
            "故乡本也如此，——虽然没有进步，也未必有如我所感的悲凉，这只是我自己心情的改变罢了，"
            "因为我这次回乡，本是为了别它而来的。",
            "深蓝的天空中挂着一轮金黄的圆月，下面是海边的沙地，都种着一望无际的碧绿的西瓜，"
            "其间有一个十一二岁的少年，项带银圈，手捏一柄钢叉，向一匹猹尽力的刺去，那猹却将身一扭，"
            "反从他的胯下逃走了。",
        ],
    ),
]

PANGHUANG = [
    chapter(
        "第一篇 祝福",
        [
            "旧历的年底毕竟最像年底，村镇上不必说，就在天空中也显出将到新年的气象来。"
            "灰白色的沉重的晚云中间时时发出闪光，接着一声钝响，是送灶的爆竹；"
            "近处燃放的可就更强烈了，震耳的大音还没有息，空气里已经散满了幽微的火药香。",
            "她不是鲁镇人。有一年的冬初，四叔家里要换女工，做中人的卫老婆子带她进来了，"
            "头上扎着白头绳，乌裙，蓝夹袄，月白背心，年纪大约二十六七，脸色青黄，但两颊却还是红的。",
        ],
    ),
    chapter(
        "第二篇 在酒楼上",
        [
            "我从北地向东南旅行，绕道访了我的家乡，就到S城。这一夜，我就在城南的s城石桥边的一家小酒楼上。",
            "楼上「空空如也」，任凭我壬人生悲慨，也尽够徘徊了。（本篇节选演示文本到此为止，"
            "以下为排版演示用的补白段落。）",
            "雪花下来了，又有梅花，宜城柳色，无处不满。览物之情，得无异乎。"
            "斗转星移，寒来暑往；春诵夏弦，秋收冬藏。天地玄黄，宇宙洪荒。",
        ],
    ),
    chapter(
        "第三篇 长明灯",
        [
            "（本篇为排版演示用的补白文本。）吉光屯的长明灯，从梁武帝以来，一直点着，"
            "仿佛从盘古开辟了天地以后，就点着了。",
            "四铭居仁堂的大窗，白糊糊地透出亮光；几株老梅竟斗雪开着满树的繁花，"
            "仿佛毫不以深冬为意；倒塌的亭子边还有一株山茶树，暗红的盛开厚的花。",
        ],
    ),
]


def make_cover(title: str, author: str, path: Path) -> None:
    w, h = 1200, 1600
    img = Image.new("RGB", (w, h), PAPER)
    draw = ImageDraw.Draw(img)
    # 细边框
    draw.rectangle([48, 48, w - 48, h - 48], outline=(214, 206, 192), width=3)
    # 竖排书名
    font_big = ImageFont.truetype(SONG, 190)
    x = w // 2 - 95
    y = 300
    for ch in title:
        draw.text((x, y), ch, font=font_big, fill=INK)
        y += 230
    # 朱红书签
    draw.rectangle([w - 320, 130, w - 240, 430], fill=ACCENT)
    # 作者
    font_small = ImageFont.truetype(SONG, 72)
    draw.text((x + 60, y + 120), author + "  著", font=font_small, fill=(120, 112, 100))
    img.save(path, "PNG")


def epub_chapter(title: str, paragraphs: list[str]) -> str:
    body = "".join(f"<p>{p}</p>" for p in paragraphs)
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" lang="zh">\n'
        f"<head><title>{title}</title></head>\n<body>\n<h1>{title}</h1>\n{body}\n</body>\n</html>\n"
    )


def make_epub(path: Path, title: str, author: str, chapters: list[tuple[str, list[str]]], cover_png: bytes) -> None:
    opf = f'''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:demo-{title}</dc:identifier>
    <dc:title>{title}</dc:title>
    <dc:creator>{author}</dc:creator>
    <dc:language>zh</dc:language>
    <meta property="dcterms:modified">2026-10-16T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    {"".join(f'<item id="c{i}" href="c{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(len(chapters)))}
  </manifest>
  <spine>
    <itemref idref="cover"/>
    {"".join(f'<itemref idref="c{i}"/>' for i in range(len(chapters)))}
  </spine>
</package>
'''
    nav = f'''<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh">
<head><title>目录</title></head>
<body>
<nav epub:type="toc" id="toc"><h1>目录</h1><ol>
<li><a href="cover.xhtml">封面</a></li>
{"".join(f'<li><a href="c{i}.xhtml">{t}</a></li>' for i, (t, _) in enumerate(chapters))}
</ol></nav>
</body>
</html>
'''
    cover_xhtml = f'''<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh">
<head><title>封面</title></head>
<body style="text-align:center;margin:0">
<img src="images/cover.png" alt="{title}" style="max-width:100%"/>
</body>
</html>
'''
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", '''<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
''')
        z.writestr("OEBPS/content.opf", opf)
        z.writestr("OEBPS/nav.xhtml", nav)
        z.writestr("OEBPS/cover.xhtml", cover_xhtml)
        z.writestr("OEBPS/images/cover.png", cover_png)
        for i, (t, paras) in enumerate(chapters):
            z.writestr(f"OEBPS/c{i}.xhtml", epub_chapter(t, paras))


def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)

    (out / "《呐喊》鲁迅.txt").write_text("".join(NAIHAN), encoding="utf-8")
    (out / "《彷徨》鲁迅.txt").write_text("".join(PANGHUANG), encoding="utf-8")

    zhaoHua = [
        ("小引", [
            "我常想在纷扰中寻出一点闲静来，然而委实不容易。目前是这么离奇，心里是这么芜杂。"
            "一个人做到只剩了回忆的时候，生涯大概总要算是无聊了罢，但有时竟会连回忆也没有。",
            "带露折花，色香自然要好得多，但是我不能够。"
        ]),
        ("从百草园到三味书屋", [
            "我家的后面有一个很大的园，相传叫作百草园。现在是早已并屋子一起卖给朱文公的子孙了，"
            "连那最末次的相见也已经隔了七八年，其中似乎确凿只有一些野草；但那时却是我的乐园。",
            "不必说碧绿的菜畦，光滑的石井栏，高大的皂荚树，紫红的桑椹；也不必说鸣蝉在树叶里长吟，"
            "肥胖的黄蜂伏在菜花上，轻捷的叫天子（云雀）忽然从草间直窜向云霄里去了。"
            "单是周围的短短的泥墙根一带，就有无限趣味。油蛉在这里低唱，蟋蟀们在这里弹琴。",
        ]),
        ("藤野先生", [
            "东京也无非是这样。上野的樱花烂熳的时节，望去确也像绯红的轻云，"
            "但花下也缺不了成群结队的「清国留学生」的速成班，头顶上盘着大辫子，"
            "顶得学生制帽的顶上高高耸起，形成一座富士山。",
            "中国是弱国，所以中国人当然是低能儿，分数在六十分以上，便不是自己的能力了："
            "也无怪他们疑惑。但在那时那地，我的意见却变化了。",
        ]),
        ("阿长与《山海经》", [
            "长妈妈，已经说过，是一个一向带领着我的女工，说得阔气一点，就是我的保姆。"
            "母亲和许多别的人都这样称呼她，似乎略带些客气的意思。",
            "她谋害了隐鼠，却是我的保姆，都是真实；然而我有一时也对她发生过空前的敬意。"
            "别人不肯做，或不能做的事，她却能够做成功。她确有伟大的神力。",
        ]),
    ]
    cover_path = out / "_cover-zhao.png"
    make_cover("朝花夕拾", "鲁迅", cover_path)
    cover_bytes = cover_path.read_bytes()
    cover_path.unlink()
    make_epub(out / "《朝花夕拾》鲁迅.epub", "朝花夕拾", "鲁迅", zhaoHua, cover_bytes)

    print("演示书已生成：", ", ".join(p.name for p in sorted(out.iterdir())))


if __name__ == "__main__":
    main()
