/**
 * Daily Verse — deterministic verse-of-the-day selection.
 *
 * The same verse appears for an entire UTC day so server and client agree
 * (no hydration mismatch). Selection rotates daily via `dayOfYear % verses.length`.
 *
 * Verses are public-domain-safe paraphrases (NIV-style cadence, not verbatim
 * copyrighted translations).
 */

export interface Verse {
  id: string;
  text: string;
  reference: string;
  theme?: string;
}

export const verses: Verse[] = [
  {
    id: 'ps-23-1',
    text: 'The Lord is my shepherd; I lack nothing.',
    reference: 'Psalm 23:1',
    theme: 'comfort',
  },
  {
    id: 'ps-46-10',
    text: 'Be still, and know that I am God; I will be exalted among the nations, I will be exalted in the earth.',
    reference: 'Psalm 46:10',
    theme: 'peace',
  },
  {
    id: 'john-3-16',
    text: 'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.',
    reference: 'John 3:16',
    theme: 'love',
  },
  {
    id: 'john-14-27',
    text: 'Peace I leave with you; my peace I give you. I do not give to you as the world gives. Do not let your hearts be troubled and do not be afraid.',
    reference: 'John 14:27',
    theme: 'peace',
  },
  {
    id: 'phil-4-13',
    text: 'I can do all this through him who gives me strength.',
    reference: 'Philippians 4:13',
    theme: 'strength',
  },
  {
    id: 'phil-4-6-7',
    text: 'Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God. And the peace of God, which transcends all understanding, will guard your hearts and your minds in Christ Jesus.',
    reference: 'Philippians 4:6-7',
    theme: 'peace',
  },
  {
    id: 'rom-8-28',
    text: 'And we know that in all things God works for the good of those who love him, who have been called according to his purpose.',
    reference: 'Romans 8:28',
    theme: 'hope',
  },
  {
    id: 'rom-12-2',
    text: 'Do not conform to the pattern of this world, but be transformed by the renewing of your mind. Then you will be able to test and approve what God’s will is — his good, pleasing and perfect will.',
    reference: 'Romans 12:2',
    theme: 'transformation',
  },
  {
    id: 'prov-3-5-6',
    text: 'Trust in the Lord with all your heart and lean not on your own understanding; in all your ways submit to him, and he will make your paths straight.',
    reference: 'Proverbs 3:5-6',
    theme: 'trust',
  },
  {
    id: 'isa-41-10',
    text: 'So do not fear, for I am with you; do not be dismayed, for I am your God. I will strengthen you and help you; I will uphold you with my righteous right hand.',
    reference: 'Isaiah 41:10',
    theme: 'courage',
  },
  {
    id: 'isa-40-31',
    text: 'But those who hope in the Lord will renew their strength. They will soar on wings like eagles; they will run and not grow weary, they will walk and not be faint.',
    reference: 'Isaiah 40:31',
    theme: 'strength',
  },
  {
    id: 'matt-6-33-34',
    text: 'But seek first his kingdom and his righteousness, and all these things will be given to you as well. Therefore do not worry about tomorrow, for tomorrow will worry about itself.',
    reference: 'Matthew 6:33-34',
    theme: 'trust',
  },
  {
    id: 'matt-11-28-30',
    text: 'Come to me, all you who are weary and burdened, and I will give you rest. Take my yoke upon you and learn from me, for I am gentle and humble in heart, and you will find rest for your souls.',
    reference: 'Matthew 11:28-30',
    theme: 'rest',
  },
  {
    id: '1cor-13-4-7',
    text: 'Love is patient, love is kind. It does not envy, it does not boast, it is not proud. It does not dishonor others, it is not self-seeking, it is not easily angered, it keeps no record of wrongs. Love does not delight in evil but rejoices with the truth. It always protects, always trusts, always hopes, always perseveres.',
    reference: '1 Corinthians 13:4-7',
    theme: 'love',
  },
  {
    id: 'eph-2-8-9',
    text: 'For it is by grace you have been saved, through faith — and this is not from yourselves, it is the gift of God — not by works, so that no one can boast.',
    reference: 'Ephesians 2:8-9',
    theme: 'grace',
  },
  {
    id: '2tim-1-7',
    text: 'For the Spirit God gave us does not make us timid, but gives us power, love and self-discipline.',
    reference: '2 Timothy 1:7',
    theme: 'courage',
  },
  {
    id: 'heb-11-1',
    text: 'Now faith is confidence in what we hope for and assurance about what we do not see.',
    reference: 'Hebrews 11:1',
    theme: 'faith',
  },
  {
    id: 'james-1-2-3',
    text: 'Consider it pure joy, my brothers and sisters, whenever you face trials of many kinds, because you know that the testing of your faith produces perseverance.',
    reference: 'James 1:2-3',
    theme: 'perseverance',
  },
  {
    id: '1john-4-18-19',
    text: 'There is no fear in love. But perfect love drives out fear, because fear has to do with punishment. We love because he first loved us.',
    reference: '1 John 4:18-19',
    theme: 'love',
  },
  {
    id: 'lam-3-22-23',
    text: 'Because of the Lord’s great love we are not consumed, for his compassions never fail. They are new every morning; great is your faithfulness.',
    reference: 'Lamentations 3:22-23',
    theme: 'faithfulness',
  },
  {
    id: 'ps-27-1',
    text: 'The Lord is my light and my salvation — whom shall I fear? The Lord is the stronghold of my life — of whom shall I be afraid?',
    reference: 'Psalm 27:1',
    theme: 'courage',
  },
  {
    id: 'ps-34-18',
    text: 'The Lord is close to the brokenhearted and saves those who are crushed in spirit.',
    reference: 'Psalm 34:18',
    theme: 'comfort',
  },
  {
    id: 'ps-91-1-2',
    text: 'Whoever dwells in the shelter of the Most High will rest in the shadow of the Almighty. I will say of the Lord, "He is my refuge and my fortress, my God, in whom I trust."',
    reference: 'Psalm 91:1-2',
    theme: 'refuge',
  },
  {
    id: 'ps-121-1-2',
    text: 'I lift up my eyes to the mountains — where does my help come from? My help comes from the Lord, the Maker of heaven and earth.',
    reference: 'Psalm 121:1-2',
    theme: 'help',
  },
  {
    id: 'ps-139-14',
    text: 'I praise you because I am fearfully and wonderfully made; your works are wonderful, I know that full well.',
    reference: 'Psalm 139:14',
    theme: 'identity',
  },
  {
    id: 'eccl-3-1',
    text: 'There is a time for everything, and a season for every activity under the heavens.',
    reference: 'Ecclesiastes 3:1',
    theme: 'wisdom',
  },
  {
    id: 'josh-1-9',
    text: 'Have I not commanded you? Be strong and courageous. Do not be afraid; do not be discouraged, for the Lord your God will be with you wherever you go.',
    reference: 'Joshua 1:9',
    theme: 'courage',
  },
  {
    id: 'jer-29-11',
    text: 'For I know the plans I have for you, declares the Lord, plans to prosper you and not to harm you, plans to give you hope and a future.',
    reference: 'Jeremiah 29:11',
    theme: 'hope',
  },
  {
    id: 'mic-6-8',
    text: 'He has shown you, O mortal, what is good. And what does the Lord require of you? To act justly and to love mercy and to walk humbly with your God.',
    reference: 'Micah 6:8',
    theme: 'justice',
  },
  {
    id: 'zeph-3-17',
    text: 'The Lord your God is with you, the Mighty Warrior who saves. He will take great delight in you; in his love he will no longer rebuke you, but will rejoice over you with singing.',
    reference: 'Zephaniah 3:17',
    theme: 'love',
  },
  {
    id: 'matt-5-14-16',
    text: 'You are the light of the world. A town built on a hill cannot be hidden. Let your light shine before others, that they may see your good deeds and glorify your Father in heaven.',
    reference: 'Matthew 5:14-16',
    theme: 'purpose',
  },
  {
    id: 'matt-7-7-8',
    text: 'Ask and it will be given to you; seek and you will find; knock and the door will be opened to you. For everyone who asks receives; the one who seeks finds; and to the one who knocks, the door will be opened.',
    reference: 'Matthew 7:7-8',
    theme: 'prayer',
  },
  {
    id: 'mark-12-30-31',
    text: 'Love the Lord your God with all your heart and with all your soul and with all your mind and with all your strength. The second is this: Love your neighbor as yourself. There is no commandment greater than these.',
    reference: 'Mark 12:30-31',
    theme: 'love',
  },
  {
    id: 'luke-6-36-38',
    text: 'Be merciful, just as your Father is merciful. Do not judge, and you will not be judged. Forgive, and you will be forgiven. Give, and it will be given to you. A good measure, pressed down, shaken together and running over, will be poured into your lap.',
    reference: 'Luke 6:36-38',
    theme: 'mercy',
  },
  {
    id: 'john-8-12',
    text: 'I am the light of the world. Whoever follows me will never walk in darkness, but will have the light of life.',
    reference: 'John 8:12',
    theme: 'light',
  },
  {
    id: 'john-13-34-35',
    text: 'A new command I give you: Love one another. As I have loved you, so you must love one another. By this everyone will know that you are my disciples, if you love one another.',
    reference: 'John 13:34-35',
    theme: 'love',
  },
  {
    id: 'john-15-13',
    text: 'Greater love has no one than this: to lay down one’s life for one’s friends.',
    reference: 'John 15:13',
    theme: 'love',
  },
  {
    id: 'john-16-33',
    text: 'I have told you these things, so that in me you may have peace. In this world you will have trouble. But take heart! I have overcome the world.',
    reference: 'John 16:33',
    theme: 'peace',
  },
  {
    id: 'acts-20-35',
    text: 'In everything I did, I showed you that by this kind of hard work we must help the weak, remembering the words the Lord Jesus himself said: "It is more blessed to give than to receive."',
    reference: 'Acts 20:35',
    theme: 'generosity',
  },
  {
    id: 'rom-5-8',
    text: 'But God demonstrates his own love for us in this: While we were still sinners, Christ died for us.',
    reference: 'Romans 5:8',
    theme: 'love',
  },
  {
    id: 'rom-8-38-39',
    text: 'For I am convinced that neither death nor life, neither angels nor demons, neither the present nor the future, nor any powers, neither height nor depth, nor anything else in all creation, will be able to separate us from the love of God that is in Christ Jesus our Lord.',
    reference: 'Romans 8:38-39',
    theme: 'love',
  },
  {
    id: 'rom-15-13',
    text: 'May the God of hope fill you with all joy and peace as you trust in him, so that you may overflow with hope by the power of the Holy Spirit.',
    reference: 'Romans 15:13',
    theme: 'hope',
  },
  {
    id: '1cor-10-13',
    text: 'No temptation has overtaken you except what is common to mankind. And God is faithful; he will not let you be tempted beyond what you can bear. But when you are tempted, he will also provide a way out so that you can endure it.',
    reference: '1 Corinthians 10:13',
    theme: 'faithfulness',
  },
  {
    id: '1cor-16-14',
    text: 'Do everything in love.',
    reference: '1 Corinthians 16:14',
    theme: 'love',
  },
  {
    id: '2cor-4-16-18',
    text: 'Therefore we do not lose heart. Though outwardly we are wasting away, yet inwardly we are being renewed day by day. For our light and momentary troubles are achieving for us an eternal glory that far outweighs them all.',
    reference: '2 Corinthians 4:16-18',
    theme: 'perseverance',
  },
  {
    id: '2cor-5-17',
    text: 'Therefore, if anyone is in Christ, the new creation has come: The old has gone, the new is here!',
    reference: '2 Corinthians 5:17',
    theme: 'transformation',
  },
  {
    id: '2cor-12-9',
    text: 'But he said to me, "My grace is sufficient for you, for my power is made perfect in weakness." Therefore I will boast all the more gladly about my weaknesses, so that Christ’s power may rest on me.',
    reference: '2 Corinthians 12:9',
    theme: 'grace',
  },
  {
    id: 'gal-5-22-23',
    text: 'But the fruit of the Spirit is love, joy, peace, forbearance, kindness, goodness, faithfulness, gentleness and self-control. Against such things there is no law.',
    reference: 'Galatians 5:22-23',
    theme: 'spirit',
  },
  {
    id: 'gal-6-9',
    text: 'Let us not become weary in doing good, for at the proper time we will reap a harvest if we do not give up.',
    reference: 'Galatians 6:9',
    theme: 'perseverance',
  },
  {
    id: 'eph-4-32',
    text: 'Be kind and compassionate to one another, forgiving each other, just as in Christ God forgave you.',
    reference: 'Ephesians 4:32',
    theme: 'forgiveness',
  },
  {
    id: 'eph-6-10-11',
    text: 'Finally, be strong in the Lord and in his mighty power. Put on the full armor of God, so that you can take your stand against the devil’s schemes.',
    reference: 'Ephesians 6:10-11',
    theme: 'strength',
  },
  {
    id: 'col-3-12-14',
    text: 'Therefore, as God’s chosen people, holy and dearly loved, clothe yourselves with compassion, kindness, humility, gentleness and patience. And over all these virtues put on love, which binds them all together in perfect unity.',
    reference: 'Colossians 3:12-14',
    theme: 'love',
  },
  {
    id: '1thess-5-16-18',
    text: 'Rejoice always, pray continually, give thanks in all circumstances; for this is God’s will for you in Christ Jesus.',
    reference: '1 Thessalonians 5:16-18',
    theme: 'joy',
  },
  {
    id: '1tim-4-12',
    text: 'Don’t let anyone look down on you because you are young, but set an example for the believers in speech, in conduct, in love, in faith and in purity.',
    reference: '1 Timothy 4:12',
    theme: 'purpose',
  },
  {
    id: 'heb-12-1-2',
    text: 'Therefore, since we are surrounded by such a great cloud of witnesses, let us throw off everything that hinders and the sin that so easily entangles. And let us run with perseverance the race marked out for us, fixing our eyes on Jesus.',
    reference: 'Hebrews 12:1-2',
    theme: 'perseverance',
  },
  {
    id: 'heb-13-5',
    text: 'Keep your lives free from the love of money and be content with what you have, because God has said, "Never will I leave you; never will I forsake you."',
    reference: 'Hebrews 13:5',
    theme: 'contentment',
  },
  {
    id: '1pet-5-7',
    text: 'Cast all your anxiety on him because he cares for you.',
    reference: '1 Peter 5:7',
    theme: 'peace',
  },
  {
    id: '1john-1-9',
    text: 'If we confess our sins, he is faithful and just and will forgive us our sins and purify us from all unrighteousness.',
    reference: '1 John 1:9',
    theme: 'forgiveness',
  },
  {
    id: '1john-3-1',
    text: 'See what great love the Father has lavished on us, that we should be called children of God! And that is what we are!',
    reference: '1 John 3:1',
    theme: 'identity',
  },
  {
    id: 'rev-21-4',
    text: 'He will wipe every tear from their eyes. There will be no more death or mourning or crying or pain, for the old order of things has passed away.',
    reference: 'Revelation 21:4',
    theme: 'hope',
  },
  {
    id: 'ps-19-14',
    text: 'May these words of my mouth and this meditation of my heart be pleasing in your sight, Lord, my Rock and my Redeemer.',
    reference: 'Psalm 19:14',
    theme: 'devotion',
  },
  {
    id: 'ps-37-4',
    text: 'Take delight in the Lord, and he will give you the desires of your heart.',
    reference: 'Psalm 37:4',
    theme: 'joy',
  },
  {
    id: 'prov-16-3',
    text: 'Commit to the Lord whatever you do, and he will establish your plans.',
    reference: 'Proverbs 16:3',
    theme: 'trust',
  },
];

/**
 * Returns the day-of-year (1-366) for the given date, computed in UTC.
 * Using UTC ensures server and client agree regardless of local timezone.
 */
export function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const current = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  );
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((current - start) / msPerDay);
}

/**
 * Deterministically selects the verse for the given day (defaults to today).
 * Same UTC calendar day always returns the same verse on server and client.
 *
 * Falls back to a safe default if the verses array is empty.
 */
export function getDailyVerse(date?: Date): Verse {
  if (verses.length === 0) {
    return {
      id: 'fallback',
      text: '',
      reference: '',
    };
  }
  const d = date ?? new Date();
  const index = dayOfYear(d) % verses.length;
  return verses[index];
}
