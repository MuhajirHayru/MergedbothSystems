export interface LocationNode {
  id: string;
  nameEn: string;
  nameAm: string;
}

export interface RegionHierarchy extends LocationNode {
  isCharterCity?: boolean;
  subdivisionType: 'Zone' | 'Sub-City' | 'Administration';
  weredaType: 'Wereda' | 'District' | 'Kifle Ketema';
  zones: {
    id: string;
    nameEn: string;
    nameAm: string;
    weredas: {
      id: string;
      nameEn: string;
      nameAm: string;
      kebeles: string[];
    }[];
  }[];
}

export const ETHIOPIAN_REGIONS_HIERARCHY: RegionHierarchy[] = [
  {
    id: 'addis_ababa',
    nameEn: 'Addis Ababa',
    nameAm: 'አዲስ አበባ',
    isCharterCity: true,
    subdivisionType: 'Sub-City',
    weredaType: 'Kifle Ketema',
    zones: [
      {
        id: 'bole',
        nameEn: 'Bole Sub-City',
        nameAm: 'ቦሌ ክፍለ ከተማ',
        weredas: [
          { id: 'bole_w01', nameEn: 'Wereda 01 (Atlas / Edna)', nameAm: 'ወረዳ 01 (አትላስ / ኤድና)', kebeles: ['Kebele 01', 'Kebele 02', 'Airport Zone'] },
          { id: 'bole_w02', nameEn: 'Wereda 02 (Bole Medhanialem)', nameAm: 'ወረዳ 02 (ቦሌ መድኃኔዓለም)', kebeles: ['Kebele 03', 'Kebele 04', 'Cameroon St'] },
          { id: 'bole_w03', nameEn: 'Wereda 03 (Rwanda / Brass)', nameAm: 'ወረዳ 03 (ሩዋንዳ / ብራስ)', kebeles: ['Kebele 05', 'Kebele 06', 'Urael Sector'] },
          { id: 'bole_w04', nameEn: 'Wereda 04 (Gerji / Roba)', nameAm: 'ወረዳ 04 (ገርጂ / ሮባ)', kebeles: ['Kebele 07', 'Kebele 08', 'Unity Univ Area'] },
          { id: 'bole_w05', nameEn: 'Wereda 05 (Bole Bulbula)', nameAm: 'ወረዳ 05 (ቦሌ ቡልቡላ)', kebeles: ['Bulbula 93', 'Bulbula 94', 'Mariam Sefer'] },
          { id: 'bole_w06', nameEn: 'Wereda 06 (Goro / Jacros)', nameAm: 'ወረዳ 06 (ጎሮ / ጃክሮስ)', kebeles: ['Kebele 11', 'Kebele 12', 'Summit Access'] },
        ],
      },
      {
        id: 'yeka',
        nameEn: 'Yeka Sub-City',
        nameAm: 'የካ ክፍለ ከተማ',
        weredas: [
          { id: 'yeka_w01', nameEn: 'Wereda 01 (Megenagna)', nameAm: 'ወረዳ 01 (መገናኛ)', kebeles: ['Lem Hotel', 'Shola Market Sector', 'Zefmesh Area'] },
          { id: 'yeka_w02', nameEn: 'Wereda 02 (Kotebe)', nameAm: 'ወረዳ 02 (ኮተቤ)', kebeles: ['Kotebe 02', 'College Area', 'Hana Mariam'] },
          { id: 'yeka_w03', nameEn: 'Wereda 03 (Ayat)', nameAm: 'ወረዳ 03 (አያት)', kebeles: ['Ayat Zone 1', 'Ayat Zone 2', 'Tafo Access'] },
          { id: 'yeka_w04', nameEn: 'Wereda 04 (Ferensay Legasion)', nameAm: 'ወረዳ 04 (ፈረንሳይ ሌጋሲዮን)', kebeles: ['Kebele 07', 'Kebele 08', 'Embassy Sector'] },
        ],
      },
      {
        id: 'kirkos',
        nameEn: 'Kirkos Sub-City',
        nameAm: 'ቂርቆስ ክፍለ ከተማ',
        weredas: [
          { id: 'kirkos_w01', nameEn: 'Wereda 01 (Kazanchis)', nameAm: 'ወረዳ 01 (ካዛንቺስ)', kebeles: ['UNECA Corridor', 'Intercontinental Area', 'Hilton Zone'] },
          { id: 'kirkos_w02', nameEn: 'Wereda 02 (Meskel Flower)', nameAm: 'ወረዳ 02 (መስቀል ፍላወር)', kebeles: ['Dreamliner Area', 'Olympia Sector', 'Agona'] },
          { id: 'kirkos_w03', nameEn: 'Wereda 03 (Gotera / Lancha)', nameAm: 'ወረዳ 03 (ጎተራ / ላንቻ)', kebeles: ['Lancha 01', 'Gotera Interchange', 'Pepsi Area'] },
          { id: 'kirkos_w04', nameEn: 'Wereda 04 (Beherawi / Mexico)', nameAm: 'ወረዳ 04 (ብሔራዊ / ሜክሲኮ)', kebeles: ['Chamber of Commerce', 'Wabi Shebelle', 'Post Office'] },
        ],
      },
      {
        id: 'lemi_kura',
        nameEn: 'Lemi Kura Sub-City',
        nameAm: 'ለሚ ኩራ ክፍለ ከተማ',
        weredas: [
          { id: 'lk_w01', nameEn: 'Wereda 01 (Summit)', nameAm: 'ወረዳ 01 (ሰሚት)', kebeles: ['Summit Fiyel Bet', 'Pepsi Depot', 'Condo Site 1'] },
          { id: 'lk_w02', nameEn: 'Wereda 02 (CMC)', nameAm: 'ወረዳ 02 (ሲኤምሲ)', kebeles: ['St. Michael Area', 'Tsehay Real Estate', 'Civil Service'] },
          { id: 'lk_w03', nameEn: 'Wereda 03 (Ayat Real Estate)', nameAm: 'ወረዳ 03 (አያት ሪል ስቴት)', kebeles: ['Zone 3A', 'Zone 3B', 'Tafo Border'] },
        ],
      },
      {
        id: 'kolfe_keranio',
        nameEn: 'Kolfe Keranio Sub-City',
        nameAm: 'ኮልፌ ቀራኒዮ ክፍለ ከተማ',
        weredas: [
          { id: 'kk_w01', nameEn: 'Wereda 01 (Zenebework)', nameAm: 'ወረዳ 01 (ዘነበወርቅ)', kebeles: ['Kebele 01', 'Kebele 02', 'Total Sector'] },
          { id: 'kk_w02', nameEn: 'Wereda 02 (Tor Hailoch)', nameAm: 'ወረዳ 02 (ጦር ኃይሎች)', kebeles: ['Hospital Area', 'Amanuel Sector', 'Winget'] },
          { id: 'kk_w03', nameEn: 'Wereda 03 (Ayer Tena)', nameAm: 'ወረዳ 03 (አየር ጤና)', kebeles: ['Roundabout Zone', 'Alem Bank Road', 'Jemo Gate'] },
        ],
      },
      {
        id: 'nifas_silk_lafto',
        nameEn: 'Nifas Silk-Lafto Sub-City',
        nameAm: 'ንፋስ ስልክ ላፍቶ ክፍለ ከተማ',
        weredas: [
          { id: 'nsl_w01', nameEn: 'Wereda 01 (Jemo)', nameAm: 'ወረዳ 01 (ጀሞ)', kebeles: ['Jemo 1 Site', 'Jemo 2 Site', 'Jemo 3 Glass Factory'] },
          { id: 'nsl_w02', nameEn: 'Wereda 02 (Lafto Mebrat)', nameAm: 'ወረዳ 02 (ላፍቶ መብራት)', kebeles: ['Venezia Area', 'Michael Square', 'Kadisco'] },
          { id: 'nsl_w03', nameEn: 'Wereda 03 (Saris / Abo)', nameAm: 'ወረዳ 03 (ሳሪስ / አቦ)', kebeles: ['Abo Mazoriya', 'Adey Abeba Yarn', 'Grain Depot'] },
        ],
      },
      {
        id: 'arada',
        nameEn: 'Arada Sub-City',
        nameAm: 'አራዳ ክፍለ ከተማ',
        weredas: [
          { id: 'arada_w01', nameEn: 'Wereda 01 (Piazza)', nameAm: 'ወረዳ 01 (ፒያሳ)', kebeles: ['De Gaulle Square', 'Churchill Ave', 'Mahmud Music'] },
          { id: 'arada_w02', nameEn: 'Wereda 02 (4 Kilo)', nameAm: 'ወረዳ 02 (4 ኪሎ)', kebeles: ['Parliament Sector', 'AAU Science Campus', 'Ministry Area'] },
        ],
      },
      {
        id: 'addis_ketema',
        nameEn: 'Addis Ketema Sub-City (Merkato)',
        nameAm: 'አዲስ ከተማ ክፍለ ከተማ (መርካቶ)',
        weredas: [
          { id: 'ak_w01', nameEn: 'Wereda 01 (Merkato Central Produce Market)', nameAm: 'ወረዳ 01 (መርካቶ የእህል በረንዳ)', kebeles: ['Ehel Berenda', 'Atekelt Tera Fresh Market', 'Bomb Tera'] },
          { id: 'ak_w02', nameEn: 'Wereda 02 (Autobus Tera)', nameAm: 'ወረዳ 02 (አውቶቡስ ተራ)', kebeles: ['Main Bus Station', 'Shema Tera', 'Sebategna'] },
        ],
      },
    ],
  },
  {
    id: 'oromia',
    nameEn: 'Oromia',
    nameAm: 'ኦሮሚያ',
    subdivisionType: 'Zone',
    weredaType: 'Wereda',
    zones: [
      {
        id: 'east_shewa',
        nameEn: 'East Shewa Zone',
        nameAm: 'ምሥራቅ ሸዋ ዞን',
        weredas: [
          { id: 'meki', nameEn: 'Meki (Dugda Wereda)', nameAm: 'መቂ (ዱግዳ ወረዳ)', kebeles: ['01 Walda', '02 Bekele Girissa', '03 Meki Town', '04 Werji Agro-Center', '05 Shubi Gamo'] },
          { id: 'bishoftu', nameEn: 'Bishoftu (Ada\'a Wereda)', nameAm: 'ቢሾፍቱ (አዳአ ወረዳ)', kebeles: ['01 Babogaya', '02 Hora Arsedi', '03 Denkaka Teff Hub', '04 Kuriftu', '05 Godino'] },
          { id: 'adama', nameEn: 'Adama Rural & City', nameAm: 'አዳማ', kebeles: ['Kebele 01 Central', 'Kebele 04 Wonji Gate', 'Boku Agro Park', '07 Melka Adama'] },
          { id: 'batu_ziway', nameEn: 'Batu / Ziway (Adami Tullu)', nameAm: 'ባቱ / ዝዋይ (አዳሚ ቱሉ)', kebeles: ['Lake View Sector', 'Horticultural Zone 1', 'Bochessa', 'Algae Haleku'] },
          { id: 'mojo_lume', nameEn: 'Lume (Mojo Dry Port)', nameAm: 'ሉሜ (ሞጆ የደረቅ ወደብ)', kebeles: ['Dry Port Logistic Kebele', 'Ejersa', 'Koka Hydro Zone', 'Kolba'] },
          { id: 'boset', nameEn: 'Boset Wereda', nameAm: 'ቦሰት ወረዳ', kebeles: ['Bofa Town', 'Olenchiti Market', 'Doni Tomato Co-op', 'Kawa'] },
        ],
      },
      {
        id: 'west_shewa',
        nameEn: 'West Shewa Zone',
        nameAm: 'ምዕራብ ሸዋ ዞን',
        weredas: [
          { id: 'ambo', nameEn: 'Ambo Wereda', nameAm: 'አምቦ ወረዳ', kebeles: ['01 Guder Road', '02 Senkele', 'Awaro Agro Co-op', 'Dandi Lake Margin'] },
          { id: 'bako_tibe', nameEn: 'Bako Tibe (National Maize Center)', nameAm: 'ባኮ ቲቤ (የበቆሎ ማዕከል)', kebeles: ['Bako Agri Research Hub', 'Tibe Town', 'Oda Haro', 'Gibe Margin'] },
          { id: 'dendi', nameEn: 'Dendi (Ginchi)', nameAm: 'ደንዲ (ጊንጪ)', kebeles: ['Ginchi 01', 'Chilimo Forest Rim', 'Weserbi Teff'] },
        ],
      },
      {
        id: 'arsi',
        nameEn: 'Arsi Zone',
        nameAm: 'አርሲ ዞን',
        weredas: [
          { id: 'asella_tiyo', nameEn: 'Tiyo (Asella Wheat Basin)', nameAm: 'ጢዮ (አሰላ የስንዴ ቆላ)', kebeles: ['Dosha Seed Multiplication', 'Gonde Wheat Co-op', 'Asella 03', 'Chilalo Foot'] },
          { id: 'hitosa', nameEn: 'Hitosa (Iteya Grain Terminal)', nameAm: 'ሂጦሳ (እተያ እህል ተርሚናል)', kebeles: ['Iteya Commercial Market', 'Boru Jawi', 'Gonde Silos'] },
          { id: 'shirka', nameEn: 'Shirka Wereda', nameAm: 'ሽርካ ወረዳ', kebeles: ['Gobessa', 'Shirka Agro', 'Lemlem Basin'] },
        ],
      },
      {
        id: 'west_arsi',
        nameEn: 'West Arsi Zone',
        nameAm: 'ምዕራብ አርሲ ዞን',
        weredas: [
          { id: 'shashemene', nameEn: 'Shashemene Corridor', nameAm: 'ሻሸመኔ ኮሪደር', kebeles: ['Awasho Potato Wholesale', '01 Arada Market', 'Kuyera Agro Depot', 'Alelu'] },
          { id: 'kofele', nameEn: 'Kofele (Dairy & Potato)', nameAm: 'ኮፈሌ (የወተትና ድንች)', kebeles: ['Kofele 01 Dairy Union', 'Wabe Highland', 'Koma'] },
          { id: 'arsi_negele', nameEn: 'Arsi Negele', nameAm: 'አርሲ ነገሌ', kebeles: ['Negele Lake Terminal', 'Malka Oda', 'Goljota'] },
        ],
      },
      {
        id: 'jimma',
        nameEn: 'Jimma Zone',
        nameAm: 'ጅማ ዞን',
        weredas: [
          { id: 'gomma', nameEn: 'Gomma (Limu Coffee Basin)', nameAm: 'ጎማ (ሊሙ ቡና)', kebeles: ['Agaro Coffee Exchange', 'Choche Birthplace', 'Gembe Coffee Union'] },
          { id: 'mana', nameEn: 'Mana Wereda', nameAm: 'ማና ወረዳ', kebeles: ['Yebu Town', 'Bilida Specialty Wash', 'Gudeta'] },
          { id: 'kersa_jimma', nameEn: 'Kersa (Jimma)', nameAm: 'ቀርሳ (ጅማ)', kebeles: ['Serbo Central Market', 'Babia', 'Kitimbile'] },
        ],
      },
      {
        id: 'bale',
        nameEn: 'Bale Zone',
        nameAm: 'ባሌ ዞን',
        weredas: [
          { id: 'sinana', nameEn: 'Sinana (Highland Durum Wheat)', nameAm: 'ሲናና (የስንዴ ምርምር)', kebeles: ['Sinana Research Basin', 'Selka Grain Depot', 'Basotu'] },
          { id: 'robe_bale', nameEn: 'Robe Town', nameAm: 'ሮቤ ከተማ', kebeles: ['01 Commercial Gate', '02 Silo Zone', 'Bale Mts Access'] },
        ],
      },
    ],
  },
  {
    id: 'amhara',
    nameEn: 'Amhara',
    nameAm: 'አማራ',
    subdivisionType: 'Zone',
    weredaType: 'Wereda',
    zones: [
      {
        id: 'south_gondar',
        nameEn: 'South Gondar Zone',
        nameAm: 'ደቡብ ጎንደር ዞን',
        weredas: [
          { id: 'fogera', nameEn: 'Fogera (National Rice Basin)', nameAm: 'ፎገራ (የሩዝ ቆላ)', kebeles: ['Woreta Rice Exchange', 'Kuhar Michael', 'Alem Ber', 'Shina'] },
          { id: 'debre_tabor', nameEn: 'Debre Tabor City & Wereda', nameAm: 'ደብረ ታቦር', kebeles: ['01 Gafat Foundry Area', '02 Teda', 'Highland Potato Co-op'] },
          { id: 'dera', nameEn: 'Dera Wereda', nameAm: 'ደራ ወረዳ', kebeles: ['Hamusit Market', 'Anbesame Pulse Depot', 'Korata'] },
        ],
      },
      {
        id: 'west_gojjam',
        nameEn: 'West Gojjam Zone',
        nameAm: 'ምዕራብ ጎጃም ዞን',
        weredas: [
          { id: 'mecha', nameEn: 'Mecha (Koga Irrigation Scheme)', nameAm: 'መጫ (ኮጋ መስኖ)', kebeles: ['Merawi Agro Town', 'Koga Dam Vegetable Hub', 'Kudmi Maize Depot'] },
          { id: 'bure', nameEn: 'Bure (Agro-Industrial Park)', nameAm: 'ቡሬ (የግብርና ኢንዱስትሪ ፓርክ)', kebeles: ['IAIP Industrial Zone', 'Bure Baguna', 'Alefa Soybean Co-op'] },
          { id: 'bahir_dar_zuria', nameEn: 'Bahir Dar Zuria', nameAm: 'ባህር ዳር ዙሪያ', kebeles: ['Tis Abay Corridor', 'Zegie Mango Belt', 'Woramit Fruit Nursery'] },
        ],
      },
      {
        id: 'east_gojjam',
        nameEn: 'East Gojjam Zone',
        nameAm: 'ምስራቅ ጎጃም ዞን',
        weredas: [
          { id: 'debre_markos', nameEn: 'Debre Markos Area', nameAm: 'ደብረ ማርቆስ', kebeles: ['01 Chara Market', '03 Gombat Seed Center', 'Ye\'Oda Teff Depot'] },
          { id: 'dejen', nameEn: 'Dejen (Abay Gorge Gateway)', nameAm: 'ደጀን (አባይ በረሃ መግቢያ)', kebeles: ['Gorge Transport Hub', 'Yetnora Cooperative Union', 'Kurar'] },
        ],
      },
      {
        id: 'north_shewa_amhara',
        nameEn: 'North Shewa Zone (Amhara)',
        nameAm: 'ሰሜን ሸዋ ዞን (አማራ)',
        weredas: [
          { id: 'debre_berhan', nameEn: 'Debre Berhan Agri-Industrial', nameAm: 'ደብረ ብርሃን', kebeles: ['01 Chacha Dairy Corridor', '04 Agro Park', 'Tebasi Malting Barley'] },
          { id: 'kewet_shewa_robit', nameEn: 'Kewet (Shewa Robit Valley)', nameAm: 'ቀወት (ሸዋ ሮቢት)', kebeles: ['Robit Onion & Citrus Market', 'Yelen Fruit Scheme', 'Tarema'] },
        ],
      },
    ],
  },
  {
    id: 'sidama',
    nameEn: 'Sidama',
    nameAm: 'ሲዳማ',
    subdivisionType: 'Zone',
    weredaType: 'Wereda',
    zones: [
      {
        id: 'hawassa_special',
        nameEn: 'Hawassa Administrative Corridor',
        nameAm: 'ሐዋሳ አስተዳደር ኮሪደር',
        weredas: [
          { id: 'hawassa_market', nameEn: 'Hawassa Central Produce Hub', nameAm: 'ሐዋሳ ማዕከላዊ የገበያ ማዕከል', kebeles: ['Tula Agro-Substation', 'Gudumale Fresh Market', 'Datto Vegetable Terminal'] },
          { id: 'aleta_wondo', nameEn: 'Aleta Wondo (Coffee Core)', nameAm: 'አሌታ ወንዶ (ቡና ቆላ)', kebeles: ['Wondo Union Wash Station', 'Dilla Gate', 'Hunkute Organic'] },
          { id: 'dale', nameEn: 'Dale Wereda (Yirgalem IAIP)', nameAm: 'ዳሌ ወረዳ (ይርጋለም ፓርክ)', kebeles: ['Yirgalem Agro Park', 'Apostle Avocado Oil Plant', 'Mesincho Avocado Union'] },
          { id: 'wondo_genet', nameEn: 'Wondo Genet (Sugarcane & Herbs)', nameAm: 'ወንዶ ገነት (ሸንኮራና ቅመማቅመም)', kebeles: ['Forest Spring Nursery', 'Chuko Papaya Belt', 'Kole Organic'] },
        ],
      },
    ],
  },
  {
    id: 'dire_dawa',
    nameEn: 'Dire Dawa',
    nameAm: 'ድሬዳዋ',
    isCharterCity: true,
    subdivisionType: 'Administration',
    weredaType: 'District',
    zones: [
      {
        id: 'dire_dawa_metro',
        nameEn: 'Dire Dawa Urban & Eastern Free Zone',
        nameAm: 'ድሬዳዋ ከተማና ነፃ የንግድ ቀጠና',
        weredas: [
          { id: 'sabian', nameEn: 'Sabian Commercial District', nameAm: 'ሳቢያን የንግድ ዲስትሪክት', kebeles: ['Sabian Market 01', 'Kezira Railway Station', '02 Melka Terminal'] },
          { id: 'gende_kore', nameEn: 'Gende Kore Logistics Sector', nameAm: 'ገንደ ቆሬ ሎጂስቲክስ', kebeles: ['Dry Port Access', 'Industrial Park Gate', 'Kebele 06'] },
          { id: 'b_wereda_rural', nameEn: 'Dire Dawa Rural Agricultural Belt', nameAm: 'ድሬዳዋ ገጠር እርሻ ቀጠና', kebeles: ['Melka Jebdu Citrus', 'Biyo Awale Onion Co-op', 'Wahil Livestock Hub'] },
        ],
      },
    ],
  },
  {
    id: 'central_ethiopia',
    nameEn: 'Central Ethiopia',
    nameAm: 'ማዕከላዊ ኢትዮጵያ',
    subdivisionType: 'Zone',
    weredaType: 'Wereda',
    zones: [
      {
        id: 'gurage',
        nameEn: 'Gurage Zone',
        nameAm: 'ጉራጌ ዞን',
        weredas: [
          { id: 'butajira', nameEn: 'Butajira (Meskan Basin)', nameAm: 'ቡታጅራ (መስካን ቆላ)', kebeles: ['Butajira Central Pepper Market', 'Enseno Cabbage Basin', 'Batu Foot'] },
          { id: 'wolkite', nameEn: 'Wolkite (Gubre)', nameAm: 'ወልቂጤ (ጉብሬ)', kebeles: ['Wolkite 01', 'Gubre Agri College Margin', 'Endibir Enset Center'] },
        ],
      },
      {
        id: 'silte',
        nameEn: 'Silte Zone',
        nameAm: 'ስልጤ ዞን',
        weredas: [
          { id: 'worabe', nameEn: 'Worabe Commercial Center', nameAm: 'ወራቤ ንግድ ማዕከል', kebeles: ['Worabe Central Market', 'Dalocha Red Pepper Hub', 'Sankura'] },
        ],
      },
    ],
  },
  {
    id: 'southern_ethiopia',
    nameEn: 'Southern Ethiopia',
    nameAm: 'ደቡብ ኢትዮጵያ',
    subdivisionType: 'Zone',
    weredaType: 'Wereda',
    zones: [
      {
        id: 'wolaita',
        nameEn: 'Wolaita Zone',
        nameAm: 'ወላይታ ዞን',
        weredas: [
          { id: 'soddo', nameEn: 'Wolaita Soddo', nameAm: 'ወላይታ ሶዶ', kebeles: ['01 Gutu Fresh Market', 'Boditi Ginger Terminal', 'Areka Ginger Union'] },
        ],
      },
      {
        id: 'gamo',
        nameEn: 'Gamo Zone (Arba Minch)',
        nameAm: 'ጋሞ ዞን (አርባ ምንጭ)',
        weredas: [
          { id: 'arba_minch_zuria', nameEn: 'Arba Minch Banana & Fruit Belt', nameAm: 'አርባ ምንጭ የሙዝ ቀጠና', kebeles: ['Chamo Banana Plantation', 'Sikela Wholesale Terminal', 'Lante Agro-Springs'] },
        ],
      },
    ],
  },
  {
    id: 'tigray',
    nameEn: 'Tigray',
    nameAm: 'ትግራይ',
    subdivisionType: 'Zone',
    weredaType: 'Wereda',
    zones: [
      {
        id: 'south_tigray',
        nameEn: 'Southern Tigray (Raya Valley)',
        nameAm: 'ደቡብ ትግራይ (ራያ ቆላ)',
        weredas: [
          { id: 'maichew_raya', nameEn: 'Raya Alamata / Maichew Teff Basin', nameAm: 'ራያ አላማጣ / ማይጨው', kebeles: ['Alamata Grain Terminal', 'Mohoni Sorghum Scheme', 'Kobo Margin'] },
        ],
      },
    ],
  },
  {
    id: 'somali',
    nameEn: 'Somali',
    nameAm: 'ሶማሌ',
    subdivisionType: 'Zone',
    weredaType: 'Wereda',
    zones: [
      {
        id: 'jijjiga',
        nameEn: 'Fafan Zone (Jijiga Trade Hub)',
        nameAm: 'ፋፋን ዞን (ጅጅጋ የንግድ ማዕከል)',
        weredas: [
          { id: 'jijiga_town', nameEn: 'Jijiga Livestock & Trade Port', nameAm: 'ጅጅጋ እንስሳትና ንግድ ወደብ', kebeles: ['01 Livestock Exchange', 'Tog Wajale Border Transit', 'Dundhas'] },
        ],
      },
    ],
  },
];

export const getRegions = () => ETHIOPIAN_REGIONS_HIERARCHY;

export const getZonesForRegion = (regionId: string) => {
  const reg = ETHIOPIAN_REGIONS_HIERARCHY.find((r) => r.id === regionId || r.nameEn === regionId);
  return reg ? reg.zones : [];
};

export const getWeredasForZone = (regionId: string, zoneId: string) => {
  const reg = ETHIOPIAN_REGIONS_HIERARCHY.find((r) => r.id === regionId || r.nameEn === regionId);
  if (!reg) return [];
  const z = reg.zones.find((zn) => zn.id === zoneId || zn.nameEn === zoneId);
  return z ? z.weredas : [];
};

export const getKebelesForWereda = (regionId: string, zoneId: string, weredaId: string) => {
  const weredas = getWeredasForZone(regionId, zoneId);
  const w = weredas.find((wr) => wr.id === weredaId || wr.nameEn === weredaId);
  return w ? w.kebeles : [];
};
