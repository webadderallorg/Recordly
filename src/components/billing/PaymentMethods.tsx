import "./PaymentMethods.css";

const methods = [
	{ image: "cards.png", label: "Visa / Mastercard" },
	{ image: "apple-pay.png", label: "Apple Pay" },
	{ image: "google-pay.png", label: "Google Pay" },
	{ image: "link.png", label: "Link" },
];

export function PaymentMethods() {
	return (
		<div className="pricing-payment-methods">
			{methods.map(({ image, label }) => (
				<span className="pricing-payment-method" key={image}>
					<img
						src={`${import.meta.env.BASE_URL}payments/${image}`}
						alt={label}
						width={50}
						height={32}
						draggable={false}
					/>
				</span>
			))}
		</div>
	);
}
