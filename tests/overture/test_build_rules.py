"""QA P3 rules of scripts/overture/build_overture.py (pure helpers, no duckdb needed)."""
import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts', 'overture'))
import build_overture as b


class Junk(unittest.TestCase):
    def test_drops(self):
        for n, rule in [('บริษัท ธารารัตน์เพาเวอร์ เอ็นจิเนียริ่ง จำกัด', 'foreign_script'), ('Магазин Москва', 'foreign_script'),
                        ("Tall al Aḩmar (berg i Syrien, as-Suwayda', lat 32,69, long 36,62)", 'parenthetical_description'),
                        ('Tall al Bayāḑah (kulle)', 'parenthetical_description'), ('Wādī Ḑabbah (wadi i Syrien, ar-Raqqah)', 'parenthetical_description'),
                        ('Tall ‘Amūd al Khaymah', 'terrain_name'), ('Jabal Qasioun', 'terrain_name'), ('تل الأحمر', 'terrain_name'),
                        ('Express AHMAD ASWAD', 'person_name_generic'), ('Group Omar Khaled', 'person_name_generic')]:
            self.assertEqual(b.junk_rule(n), rule, n)

    def test_keeps(self):
        for n in ('Abbey road cafe', 'مطعم باباي جبلة', 'National Insurance Company', 'TRUST SYRIA Insurance Company', 'Lujain by Mourad Company',
                  "Nadia’s", "كايرو'ز CAIRO’s", 'مستشفى الرازي الخاص ( الدانا )', 'مطبعة الداية (Aldayeh Design&print)', 'Open Book Library (Obl)',
                  'Jabal Cafe', 'Tell Restaurant', 'Express Pizza', 'Salon Ahmad Alsharqeih'):
            self.assertEqual(b.junk_rule(n), '', n)


def row(i, lon, lat, name, cat='restaurant', ph='', web='', fb='', ig='', conf=0.8):
    return (f'{i:012x}', lon, lat, name, cat, ph, web, fb, ig, conf)


class NearDup(unittest.TestCase):
    def test_merges_same_name_within_200m_keeps_best(self):
        rs = [row(1, 35.9300, 35.3600, 'مطعم باباي جبلة'), row(2, 35.9302, 35.3601, 'مطعم باباي جبلة', ph='+96341000000'),
              row(3, 36.2900, 33.5100, 'Moalla Wellness Club Mazzeh', 'gym'), row(4, 36.29021, 33.5100, 'Moalla Wellness Club Mazzeh', 'gym', conf=0.9),
              row(5, 37.1500, 36.2000, 'حلب محطة بغداد', 'gas_station'), row(6, 37.1500, 36.2017, 'حلب محطة بغداد', 'gas_station')]
        kept, n = b.near_dups(rs)
        self.assertEqual(n, 3)
        ids = {r[0] for r in kept}
        self.assertIn(f'{2:012x}', ids)  # has a phone
        self.assertIn(f'{4:012x}', ids)  # higher confidence

    def test_keeps_distinct(self):
        rs = [row(1, 36.0, 34.0, 'Sea Cafe', 'cafe'), row(2, 36.0002, 34.0, 'Sham Cafe', 'cafe'),          # only the generic word matches
              row(3, 36.1, 34.0, 'Dental Clinic', 'dental_clinic'), row(4, 36.1003, 34.0, 'Whity Dental Clinic', 'dental_clinic'),
              row(5, 36.2, 34.0, 'Inanna_BAR', 'bar'), row(6, 36.2, 34.00002, 'Inanna Hotel', 'hotel'),     # different group
              row(7, 36.3, 34.0, 'Albaik Pharmacy', 'pharmacy_and_drug_store'), row(8, 36.3, 34.003, 'Albaik Pharmacy', 'pharmacy_and_drug_store')]  # ~330 m
        self.assertEqual(b.near_dups(rs)[1], 0)

    def test_coarse(self):
        self.assertTrue(b.coarse(36.3) and b.coarse(33.5) and b.coarse(37.1667) and b.coarse(36.2167))
        self.assertFalse(b.coarse(36.29635) or b.coarse(35.79145))


class Links(unittest.TestCase):
    def test_webmail_dropped(self):
        for u in ('https://blu178.mail.live.com/default.aspx?id=64855', 'http://gmail.com/', 'https://mail.google.com/mail/u/0/',
                  'https://outlook.live.com/owa/', 'https://outlook.office.com/mail/', 'http://www.hotmail.com', 'https://mail.yahoo.com/'):
            self.assertEqual(b.clean_url(u), '', u)

    def test_tracking_stripped(self):
        for u, want in [('https://www.instagram.com/alsarajj_trading1?stkn=bnEzaTc0a2szdG16', 'https://www.instagram.com/alsarajj_trading1'),
                        ('https://www.instagram.com/azizicraft?r=nametag', 'https://www.instagram.com/azizicraft'),
                        ('https://www.instagram.com/x?wa_status_inline=true&igsh=abc&igshid=def', 'https://www.instagram.com/x'),
                        ('https://maps.app.goo.gl/W7bnyxbgpE7CYZyAA?g_st=ic', 'https://maps.app.goo.gl/W7bnyxbgpE7CYZyAA'),
                        ('https://www.google.com/maps/@35.5,35.7,19z?hl=en&authuser=0', 'https://www.google.com/maps/@35.5,35.7,19z'),
                        ('https://www.researchgate.net/profile/T-K?ev=hdr_xprf&_sg=woes1G', 'https://www.researchgate.net/profile/T-K'),
                        ('https://shop.sy/p?id=5&utm_source=fb&fbclid=1&gclid=2', 'https://shop.sy/p?id=5'),
                        ('https://moadna.com/doctorprofile?id=68ca', 'https://moadna.com/doctorprofile?id=68ca')]:
            self.assertEqual(b.clean_url(u), want, u)


if __name__ == '__main__':
    unittest.main()
