ALTER TABLE order_items
    DROP CONSTRAINT IF EXISTS order_items_delivery_method_ck;

ALTER TABLE order_items
    ADD CONSTRAINT order_items_delivery_method_ck CHECK (
        market_delivery_method IS NULL
        OR market_delivery_method IN (
            'DELIVERY',
            'DIRECT_DELIVERY',
            'OVERSEAS_OTHER_DELIVERY'
        )
    );
