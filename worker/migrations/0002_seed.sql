INSERT INTO stores (id, name, type, address) VALUES
  (1, 'Tea Haven', 'food', '12 Mabini St, Makati'),
  (2, 'Burger Barn', 'food', '45 Rizal Ave, Makati'),
  (3, 'Silog Express', 'food', '8 Bonifacio St, Makati'),
  (4, 'Fresh Fold Laundry', 'laundry', '20 Luna St, Makati'),
  (5, 'Bubble Wash Laundromat', 'laundry', '77 Del Pilar St, Makati');

INSERT INTO menu_items (id, store_id, name, price) VALUES
  (1, 1, 'Wintermelon Milk Tea', 12000),
  (2, 1, 'Okinawa Milk Tea', 13000),
  (3, 1, 'Taro Milk Tea', 12500),
  (4, 1, 'Brown Sugar Boba', 14000),
  (5, 2, 'Classic Burger', 15000),
  (6, 2, 'Cheeseburger', 17000),
  (7, 2, 'Fries', 8000),
  (8, 2, 'Iced Tea', 5000),
  (9, 3, 'Tapsilog', 16000),
  (10, 3, 'Longsilog', 14000),
  (11, 3, 'Tocilog', 14000),
  (12, 3, 'Extra Rice', 2500);
