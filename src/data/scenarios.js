// Seeded household scenarios. Integer minutes from scenario start; integer dollars.
// Fixtures are deep-frozen so neither the engine nor the UI can mutate them.

function task(t) {
  return {
    status: 'todo', dependsOn: [], resources: [], earliestStartMin: 0, latestEndMin: null,
    alternatives: [], compressible: true, keywords: [], ...t,
  };
}

function deepFreeze(obj) {
  for (const v of Object.values(obj)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(obj);
}

const dinner = {
  id: 'dinner-for-six',
  name: 'Dinner for Six',
  tagline: 'Roast chicken dinner for six — guests arrive at 7:00 PM.',
  emoji: '🍽',
  clockStartMin: 16 * 60,
  startMin: 0,
  deadlineMin: 180,
  deadlineLabel: 'guests arrive',
  budgetCap: 100,
  people: [
    { id: 'alex', name: 'Alex', availableFrom: 0, availableTo: 300 },
    { id: 'sam', name: 'Sam', availableFrom: 0, availableTo: 300 },
    { id: 'leila', name: 'Leila', availableFrom: 0, availableTo: 300, aliases: ['layla'] },
  ],
  resources: [
    { id: 'oven', name: 'Oven', capacity: 1, available: true, aliases: ['oven'] },
    { id: 'stovetop', name: 'Stovetop', capacity: 2, available: true, aliases: ['stove', 'hob', 'burners', 'cooktop'] },
    { id: 'car', name: 'Car', capacity: 1, available: true, aliases: ['car', 'vehicle'] },
  ],
  tasks: [
    task({ id: 'shop', title: 'Buy groceries', durationMin: 45, minDurationMin: 35, cost: 62, priority: 'must', eligiblePeople: ['alex', 'sam'], resources: ['car'], alternatives: ['shop-discount'], keywords: ['groceries', 'shopping', 'shop', 'store'] }),
    task({ id: 'table', title: 'Set the table', durationMin: 15, minDurationMin: 10, cost: 0, priority: 'should', eligiblePeople: ['sam', 'leila', 'alex'], keywords: ['table'] }),
    task({ id: 'tart', title: 'Bake chocolate tart', durationMin: 35, minDurationMin: 30, cost: 8, priority: 'optional', value: 4, eligiblePeople: ['leila', 'alex'], resources: ['oven'], alternatives: ['tart-fruit'], keywords: ['tart', 'dessert'] }),
    task({ id: 'marinate', title: 'Prep & marinate chicken', durationMin: 20, minDurationMin: 15, cost: 0, priority: 'must', eligiblePeople: ['leila', 'alex'], dependsOn: ['shop'], keywords: ['marinate', 'marinade', 'prep'] }),
    task({ id: 'roast', title: 'Roast chicken in the oven', durationMin: 90, minDurationMin: 80, cost: 0, priority: 'must', eligiblePeople: [], resources: ['oven'], dependsOn: ['marinate'], alternatives: ['roast-pan'], keywords: ['roast', 'chicken'] }),
    task({ id: 'sides', title: 'Cook rice & vegetables', durationMin: 30, minDurationMin: 25, cost: 0, priority: 'must', eligiblePeople: ['leila', 'sam', 'alex'], resources: ['stovetop'], dependsOn: ['shop'], keywords: ['rice', 'vegetables', 'sides'] }),
    task({ id: 'salad', title: 'Toss green salad', durationMin: 15, minDurationMin: 10, cost: 0, priority: 'should', eligiblePeople: ['sam', 'leila', 'alex'], dependsOn: ['shop'], keywords: ['salad'] }),
    task({ id: 'bread', title: 'Pick up fresh bread', durationMin: 15, minDurationMin: 15, cost: 7, priority: 'should', compressible: false, eligiblePeople: ['alex', 'sam'], resources: ['car'], keywords: ['bread', 'bakery', 'baguette'] }),
    task({ id: 'candles', title: 'Candles & playlist', durationMin: 10, minDurationMin: 10, cost: 5, priority: 'optional', value: 2, compressible: false, eligiblePeople: ['sam', 'leila', 'alex'], keywords: ['candles', 'playlist', 'music'] }),
    task({ id: 'serve', title: 'Plate & serve', durationMin: 15, minDurationMin: 10, cost: 0, priority: 'must', eligiblePeople: ['alex', 'leila'], dependsOn: ['roast', 'sides', 'salad', 'table'], softDependsOn: ['candles'], keywords: ['serve', 'plating', 'plate', 'meal'] }),
  ],
  alternatives: [
    { id: 'shop-discount', forTask: 'shop', title: 'Discount grocery run', durationMin: 55, minDurationMin: 45, cost: 46, compressible: true, eligiblePeople: ['alex', 'sam'], resources: ['car'] },
    { id: 'tart-fruit', forTask: 'tart', title: 'Fruit & yogurt cups', durationMin: 15, minDurationMin: 10, cost: 6, compressible: true, eligiblePeople: ['leila', 'sam', 'alex'], resources: [] },
    { id: 'roast-pan', forTask: 'roast', title: 'Pan-sear chicken thighs', durationMin: 35, minDurationMin: 30, cost: 6, compressible: true, eligiblePeople: ['leila', 'alex', 'sam'], resources: ['stovetop'] },
  ],
  quickCommands: [
    { label: 'Guests 1 h early + oven broke', text: 'Guests are arriving an hour early and the oven broke.' },
    { label: 'Advance clock 40 min', text: 'Advance the clock 40 minutes.' },
    { label: 'Sam can’t help', text: 'Sam cannot help anymore.' },
    { label: 'Budget is now $80', text: 'Our budget is now $80.' },
    { label: 'On time?', text: 'Can we still serve the meal on time?' },
    { label: 'Undo', text: 'Undo the last change.' },
  ],
};

const birthday = {
  id: 'childrens-birthday',
  name: "Children's Birthday",
  tagline: 'Party for eight kids — the first guests ring the bell at 5:00 PM.',
  emoji: '🎈',
  clockStartMin: 13 * 60,
  startMin: 0,
  deadlineMin: 240,
  deadlineLabel: 'the party starts',
  budgetCap: 150,
  people: [
    { id: 'parent', name: 'Parent', availableFrom: 0, availableTo: 360, aliases: ['mom', 'dad'] },
    { id: 'helper', name: 'Helper', availableFrom: 0, availableTo: 360, aliases: ['babysitter', 'nanny'] },
    { id: 'aunt', name: 'Aunt', availableFrom: 60, availableTo: 360, aliases: ['auntie', 'aunty'] },
  ],
  resources: [
    { id: 'oven', name: 'Oven', capacity: 1, available: true, aliases: ['oven'] },
    { id: 'car', name: 'Car', capacity: 1, available: true, aliases: ['car', 'vehicle'] },
  ],
  tasks: [
    task({ id: 'cake', title: 'Pick up bakery cake', durationMin: 30, minDurationMin: 30, cost: 40, priority: 'must', compressible: false, eligiblePeople: ['parent', 'helper'], resources: ['car'], alternatives: ['cake-home'], keywords: ['cake'] }),
    task({ id: 'decor', title: 'Buy decorations & balloons', durationMin: 40, minDurationMin: 30, cost: 30, priority: 'should', eligiblePeople: ['parent', 'helper'], resources: ['car'], alternatives: ['decor-diy'], keywords: ['decorations', 'balloons', 'decor'] }),
    task({ id: 'snacks', title: 'Prepare snacks & juice', durationMin: 35, minDurationMin: 25, cost: 25, priority: 'must', eligiblePeople: ['helper', 'aunt', 'parent'], keywords: ['snacks', 'juice'] }),
    task({ id: 'pizza', title: 'Bake mini pizzas', durationMin: 30, minDurationMin: 25, cost: 15, priority: 'should', eligiblePeople: ['helper', 'parent', 'aunt'], resources: ['oven'], keywords: ['pizza', 'pizzas'] }),
    task({ id: 'games', title: 'Set up party games', durationMin: 30, minDurationMin: 20, cost: 10, priority: 'optional', value: 5, eligiblePeople: ['aunt', 'helper', 'parent'], keywords: ['games'] }),
    task({ id: 'bags', title: 'Pack goody bags', durationMin: 25, minDurationMin: 20, cost: 20, priority: 'optional', value: 3, eligiblePeople: ['aunt', 'parent', 'helper'], keywords: ['goody bags', 'goody', 'bags'] }),
    task({ id: 'setup', title: 'Decorate the living room', durationMin: 45, minDurationMin: 35, cost: 0, priority: 'should', eligiblePeople: ['parent', 'helper', 'aunt'], dependsOn: ['decor'], keywords: ['living room', 'decorate'] }),
    task({ id: 'final', title: 'Final party check', durationMin: 15, minDurationMin: 10, cost: 0, priority: 'must', eligiblePeople: ['parent', 'aunt'], dependsOn: ['cake', 'snacks', 'pizza', 'setup'], softDependsOn: ['games', 'bags'], keywords: ['final check', 'walkthrough'] }),
  ],
  alternatives: [
    { id: 'cake-home', forTask: 'cake', title: 'Bake a sponge cake at home', durationMin: 70, minDurationMin: 60, cost: 14, compressible: true, eligiblePeople: ['parent', 'aunt', 'helper'], resources: ['oven'] },
    { id: 'decor-diy', forTask: 'decor', title: 'Make paper decorations', durationMin: 50, minDurationMin: 40, cost: 8, compressible: true, eligiblePeople: ['aunt', 'helper', 'parent'], resources: [] },
  ],
  quickCommands: [
    { label: 'Budget is now $90', text: 'We need to cut the budget to $90.' },
    { label: 'Advance clock 60 min', text: 'Advance the clock 60 minutes.' },
    { label: 'Helper can’t come', text: 'The helper cannot come anymore.' },
    { label: 'Party 2 h earlier', text: 'The party starts 2 hours earlier.' },
    { label: 'On time?', text: 'Are we still on track?' },
    { label: 'Undo', text: 'Undo the last change.' },
  ],
};

const outing = {
  id: 'weekend-outing',
  name: 'Weekend Outing',
  tagline: 'Family day at Lake Ridge — kayak slot means arriving by 1:00 PM.',
  emoji: '🛶',
  clockStartMin: 8 * 60,
  startMin: 0,
  deadlineMin: 300,
  deadlineLabel: 'you must arrive',
  budgetCap: 120,
  people: [
    { id: 'parent-a', name: 'Parent A', availableFrom: 0, availableTo: 420, aliases: ['parent 1'] },
    { id: 'parent-b', name: 'Parent B', availableFrom: 0, availableTo: 420, aliases: ['parent 2', 'my partner', 'partner'] },
  ],
  resources: [
    { id: 'car', name: 'Car', capacity: 1, available: true, aliases: ['car', 'vehicle'] },
    { id: 'kitchen', name: 'Kitchen', capacity: 1, available: true, aliases: ['kitchen'] },
  ],
  tasks: [
    task({ id: 'pack', title: 'Pack bags & swimwear', durationMin: 30, minDurationMin: 20, cost: 0, priority: 'must', eligiblePeople: ['parent-a', 'parent-b'], keywords: ['pack', 'packing', 'swimwear'] }),
    task({ id: 'picnic', title: 'Make picnic lunch', durationMin: 30, minDurationMin: 20, cost: 15, priority: 'must', eligiblePeople: ['parent-b', 'parent-a'], resources: ['kitchen'], alternatives: ['picnic-buy'], keywords: ['picnic', 'lunch', 'sandwiches'] }),
    task({ id: 'supplies', title: 'Buy sunscreen & snacks', durationMin: 25, minDurationMin: 20, cost: 22, priority: 'should', eligiblePeople: ['parent-a', 'parent-b'], resources: ['car'], keywords: ['sunscreen', 'supplies'] }),
    task({ id: 'fuel', title: 'Fill up the tank', durationMin: 15, minDurationMin: 15, cost: 40, priority: 'must', compressible: false, eligiblePeople: ['parent-a', 'parent-b'], resources: ['car'], keywords: ['fuel', 'gas', 'tank'] }),
    task({ id: 'tickets', title: 'Book kayak tickets', durationMin: 10, minDurationMin: 10, cost: 36, priority: 'should', compressible: false, eligiblePeople: ['parent-b', 'parent-a'], keywords: ['kayak', 'tickets'] }),
    task({ id: 'bikes', title: 'Load bikes on the rack', durationMin: 20, minDurationMin: 15, cost: 0, priority: 'optional', value: 4, eligiblePeople: ['parent-a', 'parent-b'], keywords: ['bikes', 'bike'] }),
    task({ id: 'load', title: 'Load the car', durationMin: 15, minDurationMin: 10, cost: 0, priority: 'must', eligiblePeople: ['parent-a', 'parent-b'], dependsOn: ['pack', 'picnic', 'supplies'], keywords: ['load'] }),
    task({ id: 'drive', title: 'Drive to Lake Ridge', durationMin: 75, minDurationMin: 70, cost: 0, priority: 'must', eligiblePeople: ['parent-a', 'parent-b'], resources: ['car'], dependsOn: ['load', 'fuel'], softDependsOn: ['bikes', 'tickets'], keywords: ['drive', 'driving'] }),
  ],
  alternatives: [
    { id: 'picnic-buy', forTask: 'picnic', title: 'Buy deli sandwiches', durationMin: 15, minDurationMin: 15, cost: 28, compressible: false, eligiblePeople: ['parent-a', 'parent-b'], resources: ['car'] },
  ],
  quickCommands: [
    { label: 'Arrive 2 h earlier', text: 'We need to arrive 2 hours earlier.' },
    { label: 'Advance clock 30 min', text: 'Advance the clock 30 minutes.' },
    { label: 'Parent B called away', text: 'Parent B got called into work and is unavailable.' },
    { label: 'Budget is now $100', text: 'Our budget is now $100.' },
    { label: 'On time?', text: 'Will we arrive on time?' },
    { label: 'Undo', text: 'Undo the last change.' },
  ],
};

export const SCENARIOS = deepFreeze([dinner, birthday, outing]);

export function getScenario(id) {
  return SCENARIOS.find((s) => s.id === id) || null;
}
